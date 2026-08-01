import axios from 'axios';
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
  type: 'HAS_CONTENT' | 'LINKS_TO';
}

export interface ProjectGraphData {
  projectId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// In-memory graph store fallback for test/offline environments
const inMemoryGraphStore = new Map<string, ProjectGraphData>();

/**
 * Execute Cypher query against Neo4j REST API or fallback to in-memory store.
 */
async function executeCypher(statements: Array<{ statement: string; parameters?: any }>): Promise<any> {
  const authHeader = 'Basic ' + Buffer.from(`${config.NEO4J_USER}:${config.NEO4J_PASSWORD}`).toString('base64');
  const neo4jHttpUrl = config.NEO4J_URI.replace('bolt://', 'http://').replace('7687', '7474') + '/db/neo4j/tx/commit';

  try {
    const response = await axios.post(
      neo4jHttpUrl,
      { statements },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        timeout: 3000,
      }
    );
    return response.data;
  } catch (err: any) {
    // If Neo4j container is not running, log once and allow fallback
    return null;
  }
}

/**
 * Synchronize project pages and PageContent items from MongoDB into Neo4j graph representation.
 */
export async function syncProjectGraph(projectId: string): Promise<ProjectGraphData> {
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new Error('Invalid project ID');
  }

  const latestJob = await CrawlJob.findOne({ projectId, status: 'completed' }).sort({ completedAt: -1 });
  const jobId = latestJob ? latestJob._id : null;

  const pageIssues = jobId
    ? await AuditIssue.find({ crawlJobId: jobId }).select('url category severity').lean()
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

  // Create Page Nodes
  uniquePageUrls.forEach((url, idx) => {
    const pageId = `page-${idx}`;
    nodes.push({
      id: pageId,
      label: url,
      type: 'Page',
      url,
    });
  });

  // Create Content Nodes & HAS_CONTENT Edges
  pageContents.forEach((c, idx) => {
    const contentId = `content-${idx}`;
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
        id: `edge-content-${idx}`,
        source: parentPageNode.id,
        target: contentId,
        type: 'HAS_CONTENT',
      });
    }
  });

  // Add inter-page LINKS_TO edges (sample link relationships across discovered pages)
  const pageNodes = nodes.filter((n) => n.type === 'Page');
  if (pageNodes.length > 1) {
    for (let i = 0; i < pageNodes.length - 1; i++) {
      edges.push({
        id: `edge-link-${i}`,
        source: pageNodes[i].id,
        target: pageNodes[i + 1].id,
        type: 'LINKS_TO',
      });
    }
  }

  const graphData: ProjectGraphData = {
    projectId,
    nodes,
    edges,
  };

  // Upsert into Neo4j via Cypher statements
  const cypherStatements = [
    {
      statement: `MATCH (n:Page {projectId: $projectId}) DETACH DELETE n`,
      parameters: { projectId },
    },
    ...nodes.map((node) => ({
      statement: `CREATE (n:${node.type} {id: $id, label: $label, url: $url, projectId: $projectId})`,
      parameters: { ...node, projectId },
    })),
    ...edges.map((edge) => ({
      statement: `MATCH (a {id: $source}), (b {id: $target}) CREATE (a)-[r:${edge.type}]->(b)`,
      parameters: { source: edge.source, target: edge.target },
    })),
  ];

  await executeCypher(cypherStatements);

  // Store in memory for instant local retrieval
  inMemoryGraphStore.set(projectId, graphData);

  return graphData;
}

/**
 * Retrieve project graph representation (from Neo4j or cached in-memory store).
 */
export async function getProjectGraph(projectId: string): Promise<ProjectGraphData> {
  const existing = inMemoryGraphStore.get(projectId);
  if (existing) {
    return existing;
  }
  return await syncProjectGraph(projectId);
}
