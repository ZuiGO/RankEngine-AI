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
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_checklist_api';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

// Require app & models after mock configuration
const app = require('../src/app').default;
const { User } = require('../src/models/User');
const { Project } = require('../src/models/Project');
const { CrawlJob } = require('../src/models/CrawlJob');
const { AuditIssue } = require('../src/models/AuditIssue');

const request = supertest(app);

let userAToken: string;
let userAId: string;
let userBToken: string;
let userBId: string;
let projectAId: string;
let crawlJobId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  // Register User A
  const resA = await request
    .post('/api/auth/register')
    .send({
      email: 'usera-checklist@rankengine.ai',
      password: 'password123',
      role: 'agency_owner',
      companyName: 'Company A',
    })
    .expect(201);
  userAToken = resA.body.token;
  userAId = resA.body.user.id;

  // Register User B
  const resB = await request
    .post('/api/auth/register')
    .send({
      email: 'userb-checklist@rankengine.ai',
      password: 'password123',
      role: 'marketer',
      companyName: 'Company B',
    })
    .expect(201);
  userBToken = resB.body.token;
  userBId = resB.body.user.id;

  // Create Project A (owned by User A)
  const project = new Project({
    name: 'Checklist Test Project',
    domain: 'https://site-to-check.com',
    ownerId: new mongoose.Types.ObjectId(userAId),
  });
  await project.save();
  projectAId = project._id.toString();

  // Create CrawlJob
  const job = new CrawlJob({
    projectId: project._id,
    status: 'completed',
    pageCount: 15,
  });
  await job.save();
  crawlJobId = job._id.toString();

  // Seed AuditIssues for checklist
  await AuditIssue.create([
    {
      crawlJobId: job._id,
      severity: 'critical',
      category: 'redirect',
      url: 'https://site.com/a',
      description: 'issue 1',
      recommendation: 'rec 1',
    },
    {
      crawlJobId: job._id,
      severity: 'warning',
      category: 'meta',
      url: 'https://site.com/b',
      description: 'issue 2',
      recommendation: 'rec 2',
    },
    {
      crawlJobId: job._id,
      severity: 'warning',
      category: 'meta',
      url: 'https://site.com/c',
      description: 'issue 3',
      recommendation: 'rec 3',
    },
    {
      crawlJobId: job._id,
      severity: 'passed',
      category: 'meta',
      url: 'https://site.com/d',
      description: 'issue 4',
      recommendation: 'rec 4',
    },
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Checklist REST API', () => {
  it('should fetch the checklist items grouped by severity for the project owner', async () => {
    const res = await request
      .get(`/api/crawl-jobs/${crawlJobId}/checklist`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('checklist');
    const { checklist } = res.body;

    expect(checklist.critical).toHaveLength(1);
    expect(checklist.warning).toHaveLength(2);
    expect(checklist.passed).toHaveLength(1);

    expect(checklist.critical[0].url).toBe('https://site.com/a');
    const warningUrls = checklist.warning.map((w: any) => w.url);
    expect(warningUrls).toContain('https://site.com/b');
    expect(warningUrls).toContain('https://site.com/c');
    expect(checklist.passed[0].url).toBe('https://site.com/d');
  });

  it('should reject access (403) to checklist queries by non-owners', async () => {
    await request
      .get(`/api/crawl-jobs/${crawlJobId}/checklist`)
      .set('Authorization', `Bearer ${userBToken}`)
      .expect(403);
  });

  it('should reject requests (401) without authentication token', async () => {
    await request.get(`/api/crawl-jobs/${crawlJobId}/checklist`).expect(401);
  });

  it('should return 404 for checklists on non-existent jobs', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await request
      .get(`/api/crawl-jobs/${fakeId}/checklist`)
      .set('Authorization', `Bearer ${userAToken}`)
      .expect(404);
  });
});
