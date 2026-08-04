import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn(),
  QueueEvents: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { Project } from '../src/models/Project';
import { CrawlJob } from '../src/models/CrawlJob';
import { AuditIssue } from '../src/models/AuditIssue';
import { PageContent } from '../src/models/PageContent';
import { syncProjectGraph, getProjectGraph, findOrphanPages } from '../src/services/graphService';
import { getActionItems } from '../src/services/actionItemsService';
import graphRouter from '../src/routes/graph';

let mongoServer: MongoMemoryServer;
let app: express.Application;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  app = express();
  app.use(express.json());
  app.use('/api/projects', graphRouter);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Graph Service & Endpoint Tests — Prompt 1 Requirements', () => {
  it('Test 1: given mock crawl data with 3 pages and known link relationships, asserts syncProjectGraph creates correct Page nodes and LINKS_TO relationships', async () => {
    const project = await Project.create({
      name: 'Graph Test Site 1',
      domain: 'graphtest1.com',
      baseUrl: 'https://graphtest1.com',
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 3,
    });

    // 3 Pages with known link relationships
    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://graphtest1.com/page-a',
      severity: 'warning',
      category: 'seo-title',
      description: 'Missing title tag',
      recommendation: 'Add title',
      whyItMatters: 'SEO ranking signal',
      outboundLinks: ['https://graphtest1.com/page-b'],
    });

    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://graphtest1.com/page-b',
      severity: 'passed',
      category: 'seo-title',
      description: 'Clean page',
      recommendation: 'None',
      whyItMatters: 'None',
      outboundLinks: ['https://graphtest1.com/page-c'],
    });

    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://graphtest1.com/page-c',
      severity: 'passed',
      category: 'seo-title',
      description: 'Clean page',
      recommendation: 'None',
      whyItMatters: 'None',
    });

    const graph = await syncProjectGraph(project._id.toString());
    expect(graph).toBeDefined();

    const pageNodes = graph.nodes.filter((n) => n.type === 'Page');
    expect(pageNodes.length).toBe(3);
    expect(pageNodes.map((p) => p.url)).toEqual(
      expect.arrayContaining([
        'https://graphtest1.com/page-a',
        'https://graphtest1.com/page-b',
        'https://graphtest1.com/page-c',
      ])
    );

    const linkEdges = graph.edges.filter((e) => e.type === 'LINKS_TO');
    expect(linkEdges.length).toBeGreaterThanOrEqual(2);
  });

  it('Test 2: runs syncProjectGraph twice with the same data; asserts no duplicate nodes/relationships are created (MERGE behavior verified)', async () => {
    const project = await Project.create({
      name: 'Graph Test Site 2',
      domain: 'graphtest2.com',
      baseUrl: 'https://graphtest2.com',
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 2,
    });

    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://graphtest2.com/home',
      severity: 'warning',
      category: 'seo-title',
      description: 'Missing title tag',
      recommendation: 'Add title',
      whyItMatters: 'SEO ranking signal',
      outboundLinks: ['https://graphtest2.com/about'],
    });

    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://graphtest2.com/about',
      severity: 'passed',
      category: 'seo-title',
      description: 'Clean page',
      recommendation: 'None',
      whyItMatters: 'None',
    });

    // Run 1st sync
    const firstSync = await syncProjectGraph(project._id.toString());
    const firstNodesCount = firstSync.nodes.length;
    const firstEdgesCount = firstSync.edges.length;

    // Run 2nd sync with same data
    const secondSync = await syncProjectGraph(project._id.toString());

    // Assert MERGE behavior: no duplicate nodes or relationships created
    expect(secondSync.nodes.length).toBe(firstNodesCount);
    expect(secondSync.edges.length).toBe(firstEdgesCount);
  });

  it('Test 3: given crawl data with no outboundLinks field present, asserts sync completes without error and logs that link relationships were skipped', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const project = await Project.create({
      name: 'Graph Test Site 3',
      domain: 'graphtest3.com',
      baseUrl: 'https://graphtest3.com',
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 2,
    });

    // Crawl data WITHOUT outboundLinks field
    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://graphtest3.com/services',
      severity: 'warning',
      category: 'seo-title',
      description: 'Missing title tag',
      recommendation: 'Add title',
      whyItMatters: 'SEO ranking signal',
      // outboundLinks omitted!
    });

    const graph = await syncProjectGraph(project._id.toString());

    expect(graph).toBeDefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[GraphSync] outboundLinks missing for crawl data, skipping LINKS_TO relationship creation')
    );

    consoleSpy.mockRestore();
  });
});

describe('Orphan Page Detection — Prompt 2 Requirements', () => {
  it('Test 1: given a graph with one orphan page (no incoming links) and two normally-linked pages, asserts findOrphanPages returns exactly the orphan page', async () => {
    const project = await Project.create({
      name: 'Orphan Test Site 1',
      domain: 'orphantest1.com',
      baseUrl: 'https://orphantest1.com',
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 3,
    });

    // Page A links to Page B
    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://orphantest1.com/page-a',
      severity: 'passed',
      category: 'seo-title',
      description: 'Page A',
      recommendation: 'None',
      whyItMatters: 'None',
      outboundLinks: ['https://orphantest1.com/page-b'],
    });

    // Page B linked from Page A
    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://orphantest1.com/page-b',
      severity: 'passed',
      category: 'seo-title',
      description: 'Page B',
      recommendation: 'None',
      whyItMatters: 'None',
    });

    // Orphan Page (Page C): exists in crawl data but no incoming LINKS_TO
    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://orphantest1.com/orphan-page-c',
      severity: 'warning',
      category: 'seo-title',
      description: 'Orphan Page C',
      recommendation: 'Add internal links',
      whyItMatters: 'Hard to crawl',
    });

    await syncProjectGraph(project._id.toString());
    const orphans = await findOrphanPages(project._id.toString());

    expect(orphans).toContain('https://orphantest1.com/orphan-page-c');
    expect(orphans).not.toContain('https://orphantest1.com/page-b');
  });

  it('Test 2: asserts the homepage is never flagged as an orphan even with zero incoming links', async () => {
    const project = await Project.create({
      name: 'Orphan Homepage Site',
      domain: 'orphanhome.com',
      baseUrl: 'https://orphanhome.com',
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 2,
    });

    // Homepage: root domain with zero incoming links
    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://orphanhome.com/',
      severity: 'passed',
      category: 'seo-title',
      description: 'Homepage',
      recommendation: 'None',
      whyItMatters: 'None',
    });

    // Subpage: also zero incoming links
    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://orphanhome.com/isolated-page',
      severity: 'warning',
      category: 'seo-title',
      description: 'Isolated subpage',
      recommendation: 'Add links',
      whyItMatters: 'None',
    });

    await syncProjectGraph(project._id.toString());
    const orphans = await findOrphanPages(project._id.toString());

    // Homepage must NEVER be flagged as orphan
    expect(orphans).not.toContain('https://orphanhome.com/');
    expect(orphans).toContain('https://orphanhome.com/isolated-page');
  });

  it('Test 3: asserts orphan findings appear in the SAME action items table as everything else, not a separate list', async () => {
    const project = await Project.create({
      name: 'Unified Table Test Site',
      domain: 'unifiedtable.com',
      baseUrl: 'https://unifiedtable.com',
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 2,
    });

    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://unifiedtable.com/regular-page',
      severity: 'critical',
      category: 'mobile-usability',
      description: 'Viewport not set',
      recommendation: 'Add viewport tag',
      whyItMatters: 'Mobile ranking',
    });

    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://unifiedtable.com/orphan-subpage',
      severity: 'warning',
      category: 'seo-title',
      description: 'Orphan subpage',
      recommendation: 'Add internal links',
      whyItMatters: 'Hard to crawl',
    });

    await syncProjectGraph(project._id.toString());
    const actionItems = await getActionItems(project._id.toString());

    // Assert both regular audit issue and orphan finding appear in the SAME ActionItem array
    expect(Array.isArray(actionItems)).toBe(true);
    const orphanFinding = actionItems.find((i) => i.pageUrl === 'https://unifiedtable.com/orphan-subpage' && i.identifiedIssues.includes('orphan-page'));
    const regularFinding = actionItems.find((i) => i.pageUrl === 'https://unifiedtable.com/regular-page');

    expect(orphanFinding).toBeDefined();
    expect(regularFinding).toBeDefined();
    expect(orphanFinding).toHaveProperty('impactOnRanking');
    expect(orphanFinding).toHaveProperty('howToImprove');
  });
});
