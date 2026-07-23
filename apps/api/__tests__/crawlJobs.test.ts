import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

let mongoServer: MongoMemoryServer;
const mockQueueEventHandlers: Record<string, (event: any) => Promise<void> | void> = {};

// Mock BullMQ to prevent tests from needing a running Redis server
jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation(() => ({
      add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
    })),
    Worker: jest.fn(),
    QueueEvents: jest.fn().mockImplementation(() => ({
      on: jest.fn((event: string, handler: (payload: any) => Promise<void> | void) => {
        mockQueueEventHandlers[event] = handler;
      }),
    })),
  };
});

// Setup mock env variables
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_crawls';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

// Require app & models after mock configuration
const app = require('../src/app').default;
const { User } = require('../src/models/User');
const { Organization } = require('../src/models/Organization');
const { Project } = require('../src/models/Project');
const { CrawlJob } = require('../src/models/CrawlJob');
const { AuditIssue } = require('../src/models/AuditIssue');
require('../src/queues/crawlQueueEvents');

const request = supertest(app);

let userAToken: string;
let userAId: string;
let userBToken: string;
let userBId: string;
let projectAId: string;

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
      email: 'usera-crawl@rankengine.ai',
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
      email: 'userb-crawl@rankengine.ai',
      password: 'password123',
      role: 'marketer',
      companyName: 'Company B',
    })
    .expect(201);
  userBToken = resB.body.token;
  userBId = resB.body.user.id;

  // Look up the personal org auto-created on registration
  const orgA = await Organization.findOne({ ownerId: userAId });

  // Create Project A (owned by User A's org)
  const project = new Project({
    name: 'Crawl Test Project',
    domain: 'https://site-to-crawl.com',
    organizationId: orgA!._id,
  });
  await project.save();
  projectAId = project._id.toString();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  // Clean up crawl jobs and audit issues between tests
  await CrawlJob.deleteMany({});
  await AuditIssue.deleteMany({});
});

describe('Crawl Jobs REST API & Background Queues', () => {
  it('persists the worker rawResultsRef when BullMQ emits the completed event', async () => {
    const crawlJob = await CrawlJob.create({
      projectId: new mongoose.Types.ObjectId(projectAId),
      status: 'running',
    });
    const rawResultsRef = new mongoose.Types.ObjectId().toString();

    await mockQueueEventHandlers.completed({
      jobId: crawlJob._id.toString(),
      returnvalue: JSON.stringify({
        status: 'completed',
        pageCount: 7,
        rawResultsRef,
      }),
    });

    const completedJob = await CrawlJob.findById(crawlJob._id);
    expect(completedJob!.status).toBe('completed');
    expect(completedJob!.pageCount).toBe(7);
    expect(completedJob!.rawResultsRef).toBe(rawResultsRef);
    expect(completedJob!.rawResultsRef).not.toMatch(/^mock-path\//);
  });

  describe('POST /api/projects/:id/crawl - Trigger Project Crawl', () => {
    it('should queue a crawl job for Project A when requested by User A (owner)', async () => {
      const res = await request
        .post(`/api/projects/${projectAId}/crawl`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(202);

      expect(res.body).toEqual({
        message: 'Crawl job queued successfully',
        crawlJobId: expect.any(String),
      });

      // Verify CrawlJob document was created in MongoDB
      const crawlJob = await CrawlJob.findById(res.body.crawlJobId);
      expect(crawlJob).toBeTruthy();
      expect(crawlJob!.status).toBe('queued');
      expect(crawlJob!.projectId.toString()).toBe(projectAId);
    });

    it('should reject crawl requests (403) from non-owner (User B)', async () => {
      const res = await request
        .post(`/api/projects/${projectAId}/crawl`)
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(403);

      expect(res.body.error).toBe('Forbidden: You do not own this project');
    });

    it('should return 404 for triggers on non-existent project IDs', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request
        .post(`/api/projects/${fakeId}/crawl`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(404);
    });
  });

  describe('GET /api/crawl-jobs/:id - Query Crawl Job Status', () => {
    let queuedJobId: string;
    let completedJobId: string;

    beforeEach(async () => {
      // Seed a queued job
      const qJob = new CrawlJob({
        projectId: new mongoose.Types.ObjectId(projectAId),
        status: 'queued',
      });
      await qJob.save();
      queuedJobId = qJob._id.toString();

      // Seed a completed job
      const cJob = new CrawlJob({
        projectId: new mongoose.Types.ObjectId(projectAId),
        status: 'completed',
        pageCount: 10,
        startedAt: new Date(Date.now() - 5000),
        completedAt: new Date(),
      });
      await cJob.save();
      completedJobId = cJob._id.toString();

      // Seed mock audit issues for the completed job
      await AuditIssue.create([
        {
          crawlJobId: cJob._id,
          severity: 'critical',
          category: 'meta',
          url: 'http://site.com',
          description: 'desc',
          recommendation: 'rec',
        },
        {
          crawlJobId: cJob._id,
          severity: 'critical',
          category: 'meta',
          url: 'http://site.com',
          description: 'desc',
          recommendation: 'rec',
        },
        {
          crawlJobId: cJob._id,
          severity: 'warning',
          category: 'meta',
          url: 'http://site.com',
          description: 'desc',
          recommendation: 'rec',
        },
      ]);
    });

    it('should return queued state for incomplete jobs', async () => {
      const res = await request
        .get(`/api/crawl-jobs/${queuedJobId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      expect(res.body.crawlJob.status).toBe('queued');
      expect(res.body).not.toHaveProperty('summary');
    });

    it('should return status details and severity counts summary for completed jobs', async () => {
      const res = await request
        .get(`/api/crawl-jobs/${completedJobId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      expect(res.body.crawlJob.status).toBe('completed');
      expect(res.body.summary).toEqual({
        pageCount: 10,
        criticalCount: 2,
        warningCount: 1,
        passedCount: 0,
      });
    });

    it('should reject access (403) to crawl job details for non-owner (User B)', async () => {
      await request
        .get(`/api/crawl-jobs/${completedJobId}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(403);
    });
  });
});
