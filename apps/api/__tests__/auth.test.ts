import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

jest.setTimeout(60000);

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

let mongoServer: MongoMemoryServer;

// Set mock env variables synchronously at the very top to pass Zod startup checks
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_placeholder';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

// Dynamically require app & models after env variables are configured
const app = require('../src/app').default;
const { User } = require('../src/models/User');

const request = supertest(app);

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  // Re-assign database URI to point to the in-memory server
  process.env.MONGODB_URI = uri;

  // Reconnect mongoose to memory server
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

describe('Authentication Flow', () => {
  const registerPayload = {
    email: 'test@rankengine.ai',
    password: 'password123',
    role: 'developer',
    companyName: 'RankEngine QA',
  };

  describe('POST /api/auth/register', () => {
    it('should successfully register a new user and return a JWT', async () => {
      const res = await request.post('/api/auth/register').send(registerPayload).expect(201);

      expect(res.body).toHaveProperty('token');
      expect(res.body.user).toEqual({
        id: expect.any(String),
        email: registerPayload.email,
        role: registerPayload.role,
        companyName: registerPayload.companyName,
      });

      // Verify user was stored in database
      const user = await User.findOne({ email: registerPayload.email });
      expect(user).toBeTruthy();
      expect(user!.companyName).toBe(registerPayload.companyName);
    });

    it('should fail if email validation fails', async () => {
      const res = await request
        .post('/api/auth/register')
        .send({
          ...registerPayload,
          email: 'invalid-email',
        })
        .expect(400);

      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details.email).toContain('Invalid email address');
    });

    it('should fail if role validation fails', async () => {
      const res = await request
        .post('/api/auth/register')
        .send({
          ...registerPayload,
          role: 'invalid_role',
        })
        .expect(400);

      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details.role).toContain('Role must be agency_owner, marketer, or developer');
    });

    it('should fail if email is already registered', async () => {
      // Create user first
      await request.post('/api/auth/register').send(registerPayload).expect(201);

      // Attempt second registration
      const res = await request.post('/api/auth/register').send(registerPayload).expect(409);

      expect(res.body.error).toBe('Email already registered');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // Seed user for login tests
      await request.post('/api/auth/register').send(registerPayload).expect(201);
    });

    it('should successfully log in and return a JWT', async () => {
      const res = await request
        .post('/api/auth/login')
        .send({
          email: registerPayload.email,
          password: registerPayload.password,
        })
        .expect(200);

      expect(res.body).toHaveProperty('token');
      expect(res.body.user.email).toBe(registerPayload.email);
    });

    it('should fail to log in with wrong password', async () => {
      const res = await request
        .post('/api/auth/login')
        .send({
          email: registerPayload.email,
          password: 'wrongpassword',
        })
        .expect(401);

      expect(res.body.error).toBe('Invalid email or password');
    });

    it('should fail to log in with non-existent email', async () => {
      const res = await request
        .post('/api/auth/login')
        .send({
          email: 'unknown@rankengine.ai',
          password: registerPayload.password,
        })
        .expect(401);

      expect(res.body.error).toBe('Invalid email or password');
    });
  });

  describe('Middleware requireAuth & GET /api/auth/me', () => {
    let token: string;
    let userId: string;

    beforeEach(async () => {
      const res = await request.post('/api/auth/register').send(registerPayload).expect(201);
      token = res.body.token;
      userId = res.body.user.id;
    });

    it('should return user profile if valid token is provided', async () => {
      const res = await request
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({
        id: userId,
        email: registerPayload.email,
        role: registerPayload.role,
        companyName: registerPayload.companyName,
        emailDigestEnabled: true,
        hasCompletedOnboarding: false,
        createdAt: expect.any(String),
        dataProviderCallsThisMonth: 0,
        dataProviderMonthlyLimit: 100,
        dataProviderQuotaResetAt: expect.any(String),
        planId: 'free',
        subscriptionStatus: 'active',
      });
    });

    it('should fail if authorization header is missing', async () => {
      const res = await request.get('/api/auth/me').expect(401);
      expect(res.body.error).toBe('Unauthorized: No token provided');
    });

    it('should fail if token is invalid', async () => {
      const res = await request
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalidtokenvalue')
        .expect(401);
      expect(res.body.error).toBe('Unauthorized: Invalid token');
    });

    it('should fail if token is expired', async () => {
      // Create a pre-expired token (exp set in past)
      const expiredToken = jwt.sign(
        {
          userId,
          role: registerPayload.role,
          exp: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
        },
        process.env.JWT_SECRET!
      );

      const res = await request
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
      expect(res.body.error).toBe('Unauthorized: Token expired');
    });
  });

  describe('PATCH /api/auth/onboarding-complete', () => {
    let token: string;

    beforeEach(async () => {
      const res = await request.post('/api/auth/register').send(registerPayload).expect(201);
      token = res.body.token;
    });

    it('should set hasCompletedOnboarding to true', async () => {
      const res = await request
        .patch('/api/auth/onboarding-complete')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.hasCompletedOnboarding).toBe(true);
    });

    it('should reject unauthenticated requests', async () => {
      await request.patch('/api/auth/onboarding-complete').expect(401);
    });
  });
});
