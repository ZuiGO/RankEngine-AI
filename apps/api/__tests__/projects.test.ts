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

// Setup env variables synchronously for validation config
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_projects';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

// Require app & models after env variables are ready
const app = require('../src/app').default;
const { User } = require('../src/models/User');
const { Organization } = require('../src/models/Organization');
const { Membership } = require('../src/models/Membership');
const { Project } = require('../src/models/Project');
const { crawlQueue } = require('../src/queues/crawlQueue');

const request = supertest(app);

let userAToken: string;
let userAId: string;
let userBToken: string;
let userBId: string;
let orgAId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  // Seed User A
  const resA = await request
    .post('/api/auth/register')
    .send({
      email: 'usera@rankengine.ai',
      password: 'password123',
      role: 'agency_owner',
      companyName: 'Company A',
    })
    .expect(201);
  userAToken = resA.body.token;
  userAId = resA.body.user.id;

  // Upgrade User A to Pro so keyword-tracking routes are accessible in tests
  await User.findByIdAndUpdate(userAId, {
    planId: 'pro',
    dataProviderMonthlyLimit: 2000,
  });

  // Seed User B
  const resB = await request
    .post('/api/auth/register')
    .send({
      email: 'userb@rankengine.ai',
      password: 'password123',
      role: 'marketer',
      companyName: 'Company B',
    })
    .expect(201);
  userBToken = resB.body.token;
  userBId = resB.body.user.id;

  // Upgrade User B to Pro so ownership-rejection tests still reach the route
  await User.findByIdAndUpdate(userBId, {
    planId: 'pro',
    dataProviderMonthlyLimit: 2000,
  });

  // Look up the personal org auto-created on registration
  const orgA = await Organization.findOne({ ownerId: userAId });
  orgAId = orgA!._id.toString();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Projects Management REST API', () => {
  const projectPayload = {
    name: 'Awesome SEO Audit',
    domain: 'https://awesome-site.com',
    stagingDomain: 'https://staging.awesome-site.com',
  };

  let userAProjectId: string;

  describe('POST /api/projects - Create Project', () => {
    it('should create a project under authenticated user A', async () => {
      const res = await request
        .post('/api/projects')
        .set('Authorization', `Bearer ${userAToken}`)
        .send(projectPayload)
        .expect(201);

      expect(res.body).toEqual(
        expect.objectContaining({
          _id: expect.any(String),
          name: projectPayload.name,
          domain: projectPayload.domain,
          stagingDomain: projectPayload.stagingDomain,
          organizationId: orgAId,
          deletedAt: null,
        })
      );

      userAProjectId = res.body._id;
    });

    it('should fail to create project if fields are missing', async () => {
      const res = await request
        .post('/api/projects')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({
          stagingDomain: 'https://staging.site.com',
        })
        .expect(400);

      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toHaveProperty('name');
      expect(res.body.details).toHaveProperty('domain');
    });

    it('should reject requests without authorization token', async () => {
      await request.post('/api/projects').send(projectPayload).expect(401);
    });

    it('should trigger a first audit when triggerFirstAudit is true', async () => {
      const res = await request
        .post('/api/projects')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ ...projectPayload, triggerFirstAudit: true })
        .expect(201);

      expect(res.body._firstCrawlJobId).toEqual(expect.any(String));
      // Verify a CrawlJob was created in the database
      const { CrawlJob } = require('../src/models/CrawlJob');
      const job = await CrawlJob.findById(res.body._firstCrawlJobId);
      expect(job).not.toBeNull();
      expect(job.status).toBe('queued');

      // Clean up so other tests aren't affected
      const { Project } = require('../src/models/Project');
      await Project.findByIdAndDelete(res.body._id);
    });
  });

  describe('GET /api/projects - List Projects', () => {
    it('should list projects owned by User A', async () => {
      const res = await request
        .get('/api/projects')
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]._id).toBe(userAProjectId);
    });

    it('should return empty list for User B (does not own A projects)', async () => {
      const res = await request
        .get('/api/projects')
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });
  });

  describe('GET /api/projects/:id - Get Single Project', () => {
    it('should return project details for the owner (User A)', async () => {
      const res = await request
        .get(`/api/projects/${userAProjectId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      expect(res.body._id).toBe(userAProjectId);
    });

    it('should reject access (403) for non-owner (User B)', async () => {
      const res = await request
        .get(`/api/projects/${userAProjectId}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(403);

      expect(res.body.error).toBe('Forbidden: You do not own this project');
    });

    it('should return 404 for non-existent project', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      await request
        .get(`/api/projects/${fakeId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(404);
    });
  });

  describe('PATCH /api/projects/:id - Update Project', () => {
    const updatePayload = {
      name: 'Updated Project Name',
      stagingDomain: 'https://new-staging.awesome-site.com',
    };

    it('should allow owner (User A) to update project details', async () => {
      const res = await request
        .patch(`/api/projects/${userAProjectId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send(updatePayload)
        .expect(200);

      expect(res.body.name).toBe(updatePayload.name);
      expect(res.body.stagingDomain).toBe(updatePayload.stagingDomain);
      expect(res.body.domain).toBe(projectPayload.domain); // remains unchanged
    });

    it('should reject updates (403) from non-owner (User B)', async () => {
      const res = await request
        .patch(`/api/projects/${userAProjectId}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .send({ name: 'Hacked Name' })
        .expect(403);

      expect(res.body.error).toBe('Forbidden: You do not own this project');
    });
  });

  describe('DELETE /api/projects/:id - Soft-Delete Project', () => {
    it('should reject soft-deletion (403) from non-owner (User B)', async () => {
      const res = await request
        .delete(`/api/projects/${userAProjectId}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(403);

      expect(res.body.error).toBe('Forbidden: You do not own this project');
    });

    it('should allow owner (User A) to soft-delete project', async () => {
      const res = await request
        .delete(`/api/projects/${userAProjectId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      expect(res.body.message).toBe('Project soft-deleted successfully');

      // Verify it is excluded from User A's list
      const listRes = await request
        .get('/api/projects')
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);
      expect(listRes.body).toHaveLength(0);

      // Verify direct retrieval returns 404
      await request
        .get(`/api/projects/${userAProjectId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(404);

      // Verify project is still in database but has a deletedAt timestamp
      const dbProject = await Project.findById(userAProjectId);
      expect(dbProject).toBeTruthy();
      expect(dbProject!.deletedAt).not.toBeNull();
    });
  });

  describe('PATCH /api/projects/:id - Auto migration check on stagingDomain change', () => {
    let projectNoStagingId: string;

    it('should create a project without stagingDomain', async () => {
      const res = await request
        .post('/api/projects')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ name: 'No Staging', domain: 'https://no-staging.com' })
        .expect(201);

      projectNoStagingId = res.body._id;
      expect(res.body.stagingDomain).toBeUndefined();
    });

    it('should enqueue a migration-check when stagingDomain is set for the first time', async () => {
      const before = crawlQueue.add.mock.calls.length;

      const res = await request
        .patch(`/api/projects/${projectNoStagingId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ stagingDomain: 'https://staging.no-staging.com' })
        .expect(200);

      expect(res.body._migrationCheckJobId).toBeDefined();
      expect(res.body.stagingDomain).toBe('https://staging.no-staging.com');

      expect(crawlQueue.add.mock.calls.length).toBe(before + 1);

      const lastCall = crawlQueue.add.mock.calls[crawlQueue.add.mock.calls.length - 1];
      expect(lastCall[1].type).toBe('migration-check');
    });

    it('should NOT enqueue another migration-check when same stagingDomain value is re-saved', async () => {
      const before = crawlQueue.add.mock.calls.length;

      await request
        .patch(`/api/projects/${projectNoStagingId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ stagingDomain: 'https://staging.no-staging.com' })
        .expect(200);

      expect(crawlQueue.add.mock.calls.length).toBe(before);
    });
  });

  describe('GET/POST /api/projects/:id/suggested-keywords', () => {
    let projectId: string;

    it('should create a project for keyword suggestion tests', async () => {
      const res = await request
        .post('/api/projects')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ name: 'KW Sugg Tests', domain: 'https://kw-sugg.com' })
        .expect(201);
      projectId = res.body._id;
    });

    it('should return empty array when no suggestions exist', async () => {
      const res = await request
        .get(`/api/projects/${projectId}/suggested-keywords`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should return suggestions after seeding them on the project', async () => {
      const project = await Project.findById(projectId);
      project!.suggestedKeywords = [
        { keyword: 'seo audit tool', dismissed: false, source: 'audit', createdAt: new Date() },
        {
          keyword: 'site migration checklist',
          dismissed: false,
          source: 'audit',
          createdAt: new Date(),
        },
        {
          keyword: 'keyword research guide',
          dismissed: true,
          source: 'audit',
          createdAt: new Date(),
        },
      ];
      await project!.save();

      const res = await request
        .get(`/api/projects/${projectId}/suggested-keywords`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].keyword).toBe('seo audit tool');
      expect(res.body[1].keyword).toBe('site migration checklist');
    });

    it('should dismiss a suggested keyword by index', async () => {
      await request
        .post(`/api/projects/${projectId}/suggested-keywords/0/dismiss`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      const res = await request
        .get(`/api/projects/${projectId}/suggested-keywords`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].keyword).toBe('site migration checklist');
    });

    it('should reject requests from non-owner', async () => {
      await request
        .get(`/api/projects/${projectId}/suggested-keywords`)
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(403);

      await request
        .post(`/api/projects/${projectId}/suggested-keywords/0/dismiss`)
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(403);
    });

    it('should return 400 for out-of-range index', async () => {
      await request
        .post(`/api/projects/${projectId}/suggested-keywords/999/dismiss`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(400);
    });
  });

  describe('Organization-based ownership checks', () => {
    let orgA: any;
    let orgAProjectId: string;
    let adminToken: string;

    beforeAll(async () => {
      orgA = await Organization.findOne({ ownerId: userAId });

      // Create a project directly in orgA (not via endpoint, for precise control)
      const project = new Project({
        name: 'Org A Project',
        domain: 'https://org-a-project.com',
        organizationId: orgA!._id,
      });
      await project.save();
      orgAProjectId = project._id.toString();

      // Register a third user (User C) to test membership-gated access
      const resC = await request
        .post('/api/auth/register')
        .send({
          email: 'userc-ownership@rankengine.ai',
          password: 'password123',
          role: 'agency_owner',
          companyName: 'Company C',
        })
        .expect(201);
      adminToken = resC.body.token;
    });

    it('allows org owner (User A) to access project via GET', async () => {
      const res = await request
        .get(`/api/projects/${orgAProjectId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);
      expect(res.body._id).toBe(orgAProjectId);
    });

    it('allows org owner (User A) to update project via PATCH', async () => {
      const res = await request
        .patch(`/api/projects/${orgAProjectId}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ name: 'Updated Org A Project' })
        .expect(200);
      expect(res.body.name).toBe('Updated Org A Project');
    });

    it('denies access (403) to a user from a DIFFERENT org (User B)', async () => {
      await request
        .get(`/api/projects/${orgAProjectId}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(403);
    });

    it('denies access (403) to unaffiliated user (User C) who is not a member of orgA', async () => {
      await request
        .get(`/api/projects/${orgAProjectId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });

    it('grants access to a user added as "admin" member of the org', async () => {
      // Get User C's ID from their token
      const resC = await request
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const userCId = resC.body.id;

      // Add User C as an "admin" member of orgA
      const userCOrg = await Organization.findOne({ ownerId: userCId });
      await Membership.create({
        organizationId: orgA!._id,
        userId: userCId,
        role: 'admin',
        joinedAt: new Date(),
      });

      // User C should now be able to access orgA's project
      const res = await request
        .get(`/api/projects/${orgAProjectId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body._id).toBe(orgAProjectId);

      // Clean up: remove the cross-org membership so User C's own org isolation test works
      await Membership.deleteOne({ organizationId: orgA!._id, userId: userCId });
    });

    it('isolates project listings — User B sees NO projects from orgA', async () => {
      const res = await request
        .get('/api/projects')
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(200);

      // User B should only see their own org's project(s), not orgA's
      const orgAProjects = res.body.filter((p: any) => p._id === orgAProjectId);
      expect(orgAProjects).toHaveLength(0);
    });

    it('isolates crawl-job ownership across orgs', async () => {
      const { CrawlJob } = require('../src/models/CrawlJob');

      // Create a crawl job for orgA's project
      const job = await CrawlJob.create({
        projectId: orgAProjectId,
        status: 'completed',
        pageCount: 10,
      });

      // User A (orgA member) can access it
      await request
        .get(`/api/crawl-jobs/${job._id}`)
        .set('Authorization', `Bearer ${userAToken}`)
        .expect(200);

      // User B (not in orgA) gets 403
      await request
        .get(`/api/crawl-jobs/${job._id}`)
        .set('Authorization', `Bearer ${userBToken}`)
        .expect(403);
    });
  });
});
