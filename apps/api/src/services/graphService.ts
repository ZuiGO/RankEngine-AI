import neo4j, { Driver, Session } from 'neo4j-driver';
import mongoose from 'mongoose';
import config from '../config';
import { AuditIssue } from '../models/AuditIssue';
import { PageContent } from '../models/PageContent';
import { CrawlJob } from '../models/CrawlJob';

export interface GraphNode {
  id: string;
  label: string;
  type: 'Page' | 'Content';
  contentType?: string;
  url: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'HAS_CONTENT' | 'CONTAINS' | 'LINKS_TO';
}

export interface ProjectGraphData {
  projectId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export let driver: Driver;

try {
  driver = neo4j.driver(
    config.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(config.NEO4J_USER || 'neo4j', config.NEO4J_PASSWORD || 'rankengine_password')
  );
} catch (err) {
  console.warn('[GraphService] Failed to initialize Neo4j driver:', err);
}

// In-memory graph store fallback for test/offline environments
const inMemoryGraphStore = new Map<string, ProjectGraphData>();

/**
 * Synchronize project pages and PageContent items from MongoDB into Neo4j graph representation.
 * Uses MERGE to ensure re-running a sync updates rather than duplicates nodes/relationships.
 */
export async function syncProjectGraph(projectId: string): Promise<ProjectGraphData> {
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new Error('Invalid project ID');
  }

  const latestJob = await CrawlJob.findOne({ projectId, status: 'completed' }).sort({ completedAt: -1 });
  const jobId = latestJob ? latestJob._id : null;

  const pageIssues = jobId
    ? await AuditIssue.find({ crawlJobId: jobId }).select('url category severity outboundLinks').lean()
    : [];

  const pageContents = jobId
    ? await PageContent.find({ crawlJobId: jobId }).lean()
    : await PageContent.find({ projectId }).lean();

  const uniquePageUrls = Array.from(
    new Set([
      ...pageIssues.map((p) => p.url),
      ...pageContents.map((c) => c.pageUrl),
    ])
  );

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // 1. Merge Page Nodes
  uniquePageUrls.forEach((url, idx) => {
    const pageId = `page-${url}`;
    nodes.push({
      id: pageId,
      label: url,
      type: 'Page',
      url,
    });
  });

  // 2. Merge Content Nodes & CONTAINS Relationships
  pageContents.forEach((c) => {
    const contentId = `content-${c.sourceUrl}`;
    nodes.push({
      id: contentId,
      label: `${c.contentType.toUpperCase()}: ${c.sourceUrl}`,
      type: 'Content',
      contentType: c.contentType,
      url: c.sourceUrl,
    });

    const parentPageNode = nodes.find((n) => n.type === 'Page' && n.url === c.pageUrl);
    if (parentPageNode) {
      edges.push({
        id: `contains-${parentPageNode.url}->${c.sourceUrl}`,
        source: parentPageNode.id,
        target: contentId,
        type: 'CONTAINS',
      });
    }
  });

  // 3. Process LINKS_TO relationships from outboundLinks field if present
  let hasOutboundLinks = false;
  pageIssues.forEach((issue: any) => {
    if (issue.outboundLinks && Array.isArray(issue.outboundLinks) && issue.outboundLinks.length > 0) {
      hasOutboundLinks = true;
      issue.outboundLinks.forEach((targetUrl: string) => {
        const fromNode = nodes.find((n) => n.type === 'Page' && n.url === issue.url);
        const toNode = nodes.find((n) => n.type === 'Page' && n.url === targetUrl);
        if (fromNode && toNode) {
          edges.push({
            id: `link-${fromNode.url}->${toNode.url}`,
            source: fromNode.id,
            target: toNode.id,
            type: 'LINKS_TO',
          });
        }
      });
    }
  });

  if (!hasOutboundLinks) {
    console.log('[GraphSync] outboundLinks missing for crawl data, skipping LINKS_TO relationship creation');
  }

  // Deduplicate nodes & edges for in-memory graph view
  const uniqueNodesMap = new Map<string, GraphNode>();
  nodes.forEach((n) => uniqueNodesMap.set(n.id, n));
  const uniqueNodes = Array.from(uniqueNodesMap.values());

  const uniqueEdgesMap = new Map<string, GraphEdge>();
  edges.forEach((e) => uniqueEdgesMap.set(e.id, e));
  const uniqueEdges = Array.from(uniqueEdgesMap.values());

  const graphData: ProjectGraphData = {
    projectId,
    nodes: uniqueNodes,
    edges: uniqueEdges,
  };

  // Run Neo4j Cypher MERGE queries via driver if driver/session is available
  if (driver) {
    let session: Session | null = null;
    try {
      session = driver.session();

      // MERGE Page nodes
      for (const node of uniqueNodes.filter((n) => n.type === 'Page')) {
        await session.run(
          `MERGE (p:Page {url: $url}) SET p.projectId = $projectId`,
          { url: node.url, projectId }
        );
      }

      // MERGE Content nodes & CONTAINS relationships
      for (const contentNode of uniqueNodes.filter((n) => n.type === 'Content')) {
        const parentEdge = uniqueEdges.find((e) => e.target === contentNode.id && e.type === 'CONTAINS');
        const parentUrl = parentEdge ? parentEdge.source.replace('page-', '') : '';

        await session.run(
          `MERGE (c:Content {sourceUrl: $sourceUrl})
           SET c.contentType = $contentType, c.projectId = $projectId
           WITH c
           MATCH (p:Page {url: $parentUrl})
           MERGE (p)-[:CONTAINS]->(c)`,
          {
            sourceUrl: contentNode.url,
            contentType: contentNode.contentType || 'unknown',
            parentUrl,
            projectId,
          }
        );
      }

      // MERGE LINKS_TO relationships
      for (const linkEdge of uniqueEdges.filter((e) => e.type === 'LINKS_TO')) {
        const fromUrl = linkEdge.source.replace('page-', '');
        const toUrl = linkEdge.target.replace('page-', '');

        await session.run(
          `MATCH (a:Page {url: $fromUrl}), (b:Page {url: $toUrl})
           MERGE (a)-[:LINKS_TO]->(b)`,
          { fromUrl, toUrl }
        );
      }
    } catch (err: any) {
      console.warn('[GraphSync] Neo4j session execution warning:', err?.message || err);
    } finally {
      if (session) {
        await session.close();
      }
    }
  }

  // Cache in-memory for fast API responses
  inMemoryGraphStore.set(projectId, graphData);

  return graphData;
}

/**
 * Retrieve project graph representation.
 */
export async function getProjectGraph(projectId: string): Promise<ProjectGraphData> {
  const existing = inMemoryGraphStore.get(projectId);
  if (existing) {
    return existing;
  }
  return await syncProjectGraph(projectId);
}

/**
 * Query graph layer for orphan pages (crawled pages with zero incoming LINKS_TO relationships).
 * Excludes the homepage (e.g. root '/' or 'https://domain/'), which legitimately has zero inbound internal links.
 */
export async function findOrphanPages(projectId: string): Promise<string[]> {
  const existing = inMemoryGraphStore.get(projectId);
  if (!existing) {
    return [];
  }
  const graph = existing;
  const orphanUrls: string[] = [];

  const pageNodes = graph.nodes.filter((n) => n.type === 'Page');

  for (const page of pageNodes) {
    const url = page.url;

    // Exclude homepage
    try {
      const parsed = new URL(url);
      if (parsed.pathname === '/' || parsed.pathname === '') {
        continue;
      }
    } catch {
      if (url === '/' || url === '' || url.endsWith('.com') || url.endsWith('.org') || url.endsWith('.io')) {
        continue;
      }
    }

    // Check incoming LINKS_TO edges
    const hasIncomingLink = graph.edges.some(
      (e) => e.type === 'LINKS_TO' && e.target === page.id
    );

    if (!hasIncomingLink) {
      orphanUrls.push(url);
    }
  }

  return orphanUrls;
}
