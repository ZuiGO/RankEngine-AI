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
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test_projects';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = '1h';

// Require app & models after env variables are ready
const app = require('../src/app').default;
const { User } = require('../src/models/User');
const { Project } = require('../src/models/Project');
const { crawlQueue } = require('../src/queues/crawlQueue');

const request = supertest(app);

let userAToken: string;
let userAId: string;
let userBToken: string;
let userBId: string;

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
          ownerId: userAId,
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
});
