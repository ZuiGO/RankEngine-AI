import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

let mongoServer: MongoMemoryServer;

// Mock BullMQ to prevent tests from needing a running Redis server
jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation(() => ({
      add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
      close: jest.fn().mockResolvedValue(undefined),
    })),
    Worker: jest.fn(),
    QueueEvents: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

import app from '../src/app';
import { Project } from '../src/models/Project';
import { CrawlJob } from '../src/models/CrawlJob';
import { AuditIssue } from '../src/models/AuditIssue';

const request = supertest(app);

let crawlJobId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  // Create Project
  const project = new Project({
    name: 'Schema Project',
    domain: 'https://site.com',
  });
  await project.save();

  // Create CrawlJob
  const job = new CrawlJob({
    projectId: project._id,
    status: 'completed',
    pageCount: 5,
  });
  await job.save();
  crawlJobId = job._id.toString();

  // Seed schema issues and metadata issues
  await AuditIssue.create([
    {
      crawlJobId: job._id,
      severity: 'critical',
      category: 'schema',
      url: 'https://site.com/faq',
      description: 'FAQPage missing answer',
      recommendation: 'Fix answer text',
    },
    {
      crawlJobId: job._id,
      severity: 'warning',
      category: 'meta',
      url: 'https://site.com/about',
      description: 'Meta desc missing',
      recommendation: 'Fix description',
    },
    {
      crawlJobId: job._id,
      severity: 'warning',
      category: 'schema',
      url: 'https://site.com/how-to',
      description: 'Missed opportunity: HowTo',
      recommendation: 'Add HowTo',
    },
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Checklist Schema Integration REST API', () => {
  it('should return checklist grouped with a separate schema issues section', async () => {
    const res = await request
      .get(`/api/crawl-jobs/${crawlJobId}/checklist`)
      .expect(200);

    expect(res.body).toHaveProperty('checklist');
    expect(res.body).toHaveProperty('schema');

    const { checklist, schema } = res.body;

    // Schema section contains exactly the 2 seeded schema issues
    expect(schema).toHaveLength(2);
    const schemaUrls = schema.map((s: any) => s.url);
    expect(schemaUrls).toContain('https://site.com/faq');
    expect(schemaUrls).toContain('https://site.com/how-to');

    // Standard checklists should NOT contain schema issues
    expect(checklist.critical).toHaveLength(0); // schema critical is filtered out
    expect(checklist.warning).toHaveLength(1); // contains only 'meta' warning
    expect(checklist.warning[0].url).toBe('https://site.com/about');
  });
});
