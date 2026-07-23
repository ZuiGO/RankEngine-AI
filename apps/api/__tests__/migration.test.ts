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

  // Create Project with staging domain
  const projectA = new Project({
    name: 'Migration Enabled Project',
    domain: 'https://site-to-check.com',
    stagingDomain: 'https://staging.site-to-check.com',
  });
  await projectA.save();
  projectWithStagingId = projectA._id.toString();

  // Create Project without staging domain
  const projectB = new Project({
    name: 'Standard Project',
    domain: 'https://no-staging.com',
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
        .expect(400);

      expect(res.body.error).toBe('Staging domain is not configured for this project');
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
        .expect(200);

      expect(res.body.issues).toHaveLength(2);
    });

    it('should filter issues by category when query parameters are supplied', async () => {
      const res = await request
        .get(`/api/crawl-jobs/${mockJobId}/issues?category=redirect`)
        .expect(200);

      expect(res.body.issues).toHaveLength(1);
      expect(res.body.issues[0].category).toBe('redirect');
      expect(res.body.issues[0].url).toBe('https://staging.com/path');
    });
  });
});
