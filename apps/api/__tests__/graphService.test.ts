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
import { syncProjectGraph, getProjectGraph } from '../src/services/graphService';
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

describe('Graph Service & Endpoint Tests', () => {
  it('syncs project graph nodes and edges cleanly from MongoDB', async () => {
    const project = await Project.create({
      name: 'Graph Test Site',
      domain: 'graphtest.com',
      baseUrl: 'https://graphtest.com',
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
      url: 'https://graphtest.com/about',
      severity: 'warning',
      category: 'seo-title',
      description: 'Missing meta description',
      recommendation: 'Add meta description tag',
      whyItMatters: 'Meta descriptions improve click-through rates',
    });

    await PageContent.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      pageUrl: 'https://graphtest.com/about',
      contentType: 'pdf',
      sourceUrl: 'https://graphtest.com/docs/brochure.pdf',
      extractionStatus: 'success',
    });

    const graph = await syncProjectGraph(project._id.toString());
    expect(graph).toBeDefined();
    expect(graph.projectId).toBe(project._id.toString());
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);

    const pageNode = graph.nodes.find((n) => n.type === 'Page' && n.url === 'https://graphtest.com/about');
    const contentNode = graph.nodes.find((n) => n.type === 'Content' && n.contentType === 'pdf');

    expect(pageNode).toBeDefined();
    expect(contentNode).toBeDefined();

    const edge = graph.edges.find((e) => e.type === 'HAS_CONTENT');
    expect(edge).toBeDefined();
    expect(edge!.source).toBe(pageNode!.id);
    expect(edge!.target).toBe(contentNode!.id);
  });

  it('GET /api/projects/:id/graph returns 200 with graph structure', async () => {
    const project = await Project.create({
      name: 'API Graph Site',
      domain: 'apigraph.com',
      baseUrl: 'https://apigraph.com',
    });

    const res = await request(app)
      .get(`/api/projects/${project._id}/graph`)
      .expect(200);

    expect(res.body.graph).toBeDefined();
    expect(res.body.graph.nodes).toBeDefined();
    expect(res.body.graph.edges).toBeDefined();
  });

  it('returns 400 for invalid project ID format', async () => {
    await request(app)
      .get('/api/projects/invalid-id/graph')
      .expect(400);
  });

  it('returns 404 for non-existent project', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await request(app)
      .get(`/api/projects/${fakeId}/graph`)
      .expect(404);
  });
});
