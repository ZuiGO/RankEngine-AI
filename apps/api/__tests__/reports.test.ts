import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';
import fs from 'fs';

let mongoServer: MongoMemoryServer;

// Mock BullMQ
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

process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_reports';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.STORAGE_PATH = '/tmp/rankengine-test-reports';

const app = require('../src/app').default;
const { User } = require('../src/models/User');
const { Organization } = require('../src/models/Organization');
const { Project } = require('../src/models/Project');
const { CrawlJob } = require('../src/models/CrawlJob');
const { AuditIssue } = require('../src/models/AuditIssue');
const { Report } = require('../src/models/Report');

const request = supertest(app);

let ownerToken: string;
let ownerId: string;
let orgId: string;
let projectId: string;
let crawlJobId: string;

let outsiderToken: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  // Clean up test storage directory
  if (fs.existsSync('/tmp/rankengine-test-reports')) {
    fs.rmSync('/tmp/rankengine-test-reports', { recursive: true, force: true });
  }
  fs.mkdirSync('/tmp/rankengine-test-reports', { recursive: true });

  // Register owner
  const ownerRes = await request
    .post('/api/auth/register')
    .send({
      email: 'owner@reports.test',
      password: 'password123',
      role: 'agency_owner',
      companyName: 'Report Co',
    })
    .expect(201);
  ownerToken = ownerRes.body.token;
  ownerId = ownerRes.body.user.id;

  const org = await Organization.findOne({ ownerId });
  orgId = org!._id.toString();

  // Create a project
  const projectRes = await request
    .post('/api/projects')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: 'Report Test Project', domain: 'https://example.com' })
    .expect(201);
  projectId = projectRes.body._id;

  // Create a completed crawl job
  const cj = await CrawlJob.create({
    projectId: new mongoose.Types.ObjectId(projectId),
    status: 'completed',
    pageCount: 5,
    completedAt: new Date(),
    healthScore: 72,
  });
  crawlJobId = cj._id.toString();

  // Seed audit issues
  await AuditIssue.create([
    {
      crawlJobId: cj._id,
      severity: 'critical',
      category: 'meta',
      url: '/',
      description: 'Missing meta description',
      recommendation: 'Add a unique meta description to each page',
      whyItMatters: 'Search engines display this in snippets',
    },
    {
      crawlJobId: cj._id,
      severity: 'critical',
      category: 'headings',
      url: '/about',
      description: 'Multiple H1 tags found',
      recommendation: 'Use only one H1 per page',
    },
    {
      crawlJobId: cj._id,
      severity: 'warning',
      category: 'images',
      url: '/',
      description: 'Missing alt text on 3 images',
      recommendation: 'Add descriptive alt attributes',
    },
    {
      crawlJobId: cj._id,
      severity: 'warning',
      category: 'links',
      url: '/contact',
      description: 'Broken internal link',
      recommendation: 'Fix or remove the broken link',
    },
    {
      crawlJobId: cj._id,
      severity: 'passed',
      category: 'performance',
      url: '/',
      description: 'Page load time is acceptable',
      recommendation: 'Continue monitoring page speed',
    },
  ]);

  // Register outsider
  const outsiderRes = await request
    .post('/api/auth/register')
    .send({
      email: 'outsider@reports.test',
      password: 'password123',
      role: 'developer',
      companyName: 'Outsider',
    })
    .expect(201);
  outsiderToken = outsiderRes.body.token;
});

afterAll(async () => {
  if (fs.existsSync('/tmp/rankengine-test-reports')) {
    fs.rmSync('/tmp/rankengine-test-reports', { recursive: true, force: true });
  }
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await Report.deleteMany({});
});

describe('Audit Report Generation & Download', () => {
  describe('POST /api/projects/:id/reports/generate', () => {
    it('should generate a report for the most recent completed crawl', async () => {
      const res = await request
        .post(`/api/projects/${projectId}/reports/generate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      expect(res.body.message).toBe('Report generated successfully');
      expect(res.body.report).toBeDefined();
      expect(res.body.report.id).toBeDefined();
      expect(res.body.report.downloadUrl).toContain('/download?token=');
      expect(res.body.report.fileSize).toBeGreaterThan(0);

      // Verify report doc in DB
      const report = await Report.findById(res.body.report.id);
      expect(report).not.toBeNull();
      expect(report!.projectId.toString()).toBe(projectId);
      expect(report!.crawlJobId.toString()).toBe(crawlJobId);
    });

    it('should generate a report for a specific crawlJobId', async () => {
      const res = await request
        .post(`/api/projects/${projectId}/reports/generate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ crawlJobId })
        .expect(201);

      expect(res.body.report.crawlJobId).toBe(crawlJobId);
    });

    it('should return 400 when no completed crawl exists', async () => {
      const freshProjectRes = await request
        .post('/api/projects')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Fresh Project', domain: 'https://fresh.test' })
        .expect(201);
      const freshId = freshProjectRes.body._id;

      await request
        .post(`/api/projects/${freshId}/reports/generate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(400);
    });

    it('should reject report generation for non-members', async () => {
      await request
        .post(`/api/projects/${projectId}/reports/generate`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
    });

    it('should reject report generation without auth', async () => {
      await request.post(`/api/projects/${projectId}/reports/generate`).expect(401);
    });
  });

  describe('GET /api/projects/:id/reports/:reportId/download', () => {
    let reportId: string;
    let downloadToken: string;

    beforeEach(async () => {
      const res = await request
        .post(`/api/projects/${projectId}/reports/generate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);
      reportId = res.body.report.id;
      downloadToken = new URL(res.body.report.downloadUrl, 'http://localhost').searchParams.get(
        'token'
      )!;
    });

    it('should download the report PDF with a valid token', async () => {
      const res = await request
        .get(`/api/projects/${projectId}/reports/${reportId}/download?token=${downloadToken}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('.pdf');
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should reject download without a token', async () => {
      await request
        .get(`/api/projects/${projectId}/reports/${reportId}/download`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(400);
    });

    it('should reject download with an invalid token', async () => {
      await request
        .get(`/api/projects/${projectId}/reports/${reportId}/download?token=invalidtoken123`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);
    });

    it('should reject download from a non-member', async () => {
      await request
        .get(`/api/projects/${projectId}/reports/${reportId}/download?token=${downloadToken}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
    });

    it('should reject download with expired token', async () => {
      // Manually expire the token
      await Report.findByIdAndUpdate(reportId, { tokenExpiresAt: new Date(Date.now() - 1000) });

      await request
        .get(`/api/projects/${projectId}/reports/${reportId}/download?token=${downloadToken}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(410);
    });
  });

  describe('GET /api/projects/:id/reports', () => {
    it('should list all reports for a project', async () => {
      // Generate 2 reports
      await request
        .post(`/api/projects/${projectId}/reports/generate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      await request
        .post(`/api/projects/${projectId}/reports/generate`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(201);

      const res = await request
        .get(`/api/projects/${projectId}/reports`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.reports).toBeInstanceOf(Array);
      expect(res.body.reports.length).toBe(2);
    });

    it('should reject listing from non-members', async () => {
      await request
        .get(`/api/projects/${projectId}/reports`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);
    });
  });
});
