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

// Setup mock env variables
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_schema_checklist_api';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

// Require app & models
const app = require('../src/app').default;
const { User } = require('../src/models/User');
const { Project } = require('../src/models/Project');
const { CrawlJob } = require('../src/models/CrawlJob');
const { AuditIssue } = require('../src/models/AuditIssue');

const request = supertest(app);

let userToken: string;
let userId: string;
let crawlJobId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  // Register User
  const res = await request
    .post('/api/auth/register')
    .send({
      email: 'schema-user@rankengine.ai',
      password: 'password123',
      role: 'agency_owner',
      companyName: 'Schema Agency',
    })
    .expect(201);
  userToken = res.body.token;
  userId = res.body.user.id;

  // Create Project
  const project = new Project({
    name: 'Schema Project',
    domain: 'https://site.com',
    ownerId: new mongoose.Types.ObjectId(userId),
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
      .set('Authorization', `Bearer ${userToken}`)
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
