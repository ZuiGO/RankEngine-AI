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
process.env.MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_migrations_api';
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

const request = supertest(app);

let userAToken: string;
let userAId: string;
let userBToken: string;
let userBId: string;
let projectWithStagingId: string;
let projectNoStagingId: string;

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
      email: 'usera-migration@rankengine.ai',
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
      email: 'userb-migration@rankengine.ai',
      password: 'password123',
      role: 'marketer',
      companyName: 'Company B',
    })
    .expect(201);
  userBToken = resB.body.token;
  userBId = resB.body.user.id;

  // Look up the personal org auto-created on registration
  const orgA = await Organization.findOne({ ownerId: userAId });

  // Create Project with staging domain (owned by User A's org)
  const projectA = new Project({
    name: 'Migration Enabled Project',
    domain: 'https://site-to-check.com',
    stagingDomain: 'https://staging.site-to-check.com',
    organizationId: orgA!._id,
  });
  await projectA.save();
  projectWithStagingId = projectA._id.toString();

  // Create Project without staging domain (owned by User A's org)
  const projectB = new Project({
    name: 'Standard Project',
    domain: 'https://no-staging.com',
    organizationId: orgA!._id,
  });
  await projectB.save();
  projectNoStagingId = projectB._id.toString();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await CrawlJob.deleteMany({});
  await AuditIssue.deleteMany({});
});

describe('Migration Redirect Checker REST API', () => {
  describe('POST /api/projects/:id/migration-check - Trigger Audit', () => {
    it('should queue a migration job for projects configured with a staging domain', async () => {
      const res = await request
        .post(`/api/projects/${projectWithStagingId}/migration-check`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(202);

      expect(res.body).toEqual({
        message: 'Migration check queued successfully',
        crawlJobId: expect.any(String),
      });

      // Verify Mongoose CrawlJob record
      const crawlJob = await CrawlJob.findById(res.body.crawlJobId);
      expect(crawlJob).toBeTruthy();
      expect(crawlJob!.status).toBe('queued');
      expect(crawlJob!.projectId.toString()).toBe(projectWithStagingId);
    });

    it('should return 400 error when project lacks a staging domain configuration', async () => {
      const res = await request
        .post(`/api/projects/${projectNoStagingId}/migration-check`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(400);

      expect(res.body.error).toBe('Staging domain is not configured for this project');
    });

    it('should return 403 error for triggers by non-owners', async () => {
      await request
        .post(`/api/projects/${projectWithStagingId}/migration-check`)
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(403);
    });
  });

  describe('GET /api/crawl-jobs/:id/issues - Fetch Audit Issues', () => {
    let mockJobId: string;

    beforeEach(async () => {
      const job = new CrawlJob({
        projectId: new mongoose.Types.ObjectId(projectWithStagingId),
        status: 'completed',
      });
      await job.save();
      mockJobId = job._id.toString();

      // Seed issues of different categories
      await AuditIssue.create([
        {
          crawlJobId: job._id,
          severity: 'critical',
          category: 'redirect',
          url: 'https://staging.com/path',
          description: 'Redirect issue text',
          recommendation: 'Rec',
        },
        {
          crawlJobId: job._id,
          severity: 'warning',
          category: 'meta',
          url: 'https://staging.com/meta',
          description: 'Meta issue text',
          recommendation: 'Rec',
        },
      ]);
    });

    it('should fetch all issues related to the crawl job', async () => {
      const res = await request
        .get(`/api/crawl-jobs/${mockJobId}/issues`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      expect(res.body.issues).toHaveLength(2);
    });

    it('should filter issues by category when query parameters are supplied', async () => {
      const res = await request
        .get(`/api/crawl-jobs/${mockJobId}/issues?category=redirect`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      expect(res.body.issues).toHaveLength(1);
      expect(res.body.issues[0].category).toBe('redirect');
      expect(res.body.issues[0].url).toBe('https://staging.com/path');
    });

    it('should prevent issues retrieval (403) from unauthorized users', async () => {
      await request
        .get(`/api/crawl-jobs/${mockJobId}/issues`)
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(403);
    });
  });
});
