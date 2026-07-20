import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import request from 'supertest';

jest.setTimeout(60000);

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

process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_placeholder';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';
process.env.DATAFORSEO_LOGIN = '';
process.env.DATAFORSEO_PASSWORD = '';
process.env.NODE_ENV = 'test';

const User = require('../src/models/User').default;
const Organization = require('../src/models/Organization').default;
const Membership = require('../src/models/Membership').default;
const Project = require('../src/models/Project').default;

const mockGetDomainOverview = jest.fn();
jest.mock('../src/services/dataProviderService', () => {
  const actual = jest.requireActual('../src/services/dataProviderService');
  return {
    ...actual,
    getDomainOverview: (...args: any[]) => mockGetDomainOverview(...args),
  };
});

const { app } = require('../src/app');

let testUser: any;
let testProject: any;
let token: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;

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

  testUser = await User.create({
    email: 'domainov@test.com',
    passwordHash: '$2b$10$mockhash',
    role: 'agency_owner',
    companyName: 'Test Co',
    planId: 'agency',
    dataProviderCallsThisMonth: 0,
    dataProviderMonthlyLimit: 10000,
    dataProviderQuotaResetAt: new Date(Date.UTC(2099, 0, 1)),
  });

  token = jwt.sign(
    { userId: testUser._id.toString(), role: testUser.role },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' },
  );

  const org = await Organization.create({ name: 'Test Org', ownerId: testUser._id });
  await Membership.create({ organizationId: org._id, userId: testUser._id, role: 'owner', joinedAt: new Date() });

  testProject = await Project.create({
    name: 'Test Project',
    domain: 'example.com',
    organizationId: org._id,
  });
});

describe('Domain Overview — GET', () => {
  it('returns domain overview with rich topKeywords', async () => {
    mockGetDomainOverview.mockResolvedValue({
      organicTrafficEstimate: 25000,
      organicKeywordCount: 450,
      topKeywords: [
        { keyword: 'example seo', searchVolume: 1200, position: 3 },
        { keyword: 'example marketing', searchVolume: 800, position: 5 },
      ],
    });

    const res = await request(app)
      .get(`/api/projects/${testProject._id}/domain-overview`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({
      organicTrafficEstimate: 25000,
      organicKeywordCount: 450,
      topKeywords: [
        { keyword: 'example seo', searchVolume: 1200, position: 3 },
        { keyword: 'example marketing', searchVolume: 800, position: 5 },
      ],
    });
  });

  it('caches overview per project per day', async () => {
    mockGetDomainOverview.mockResolvedValue({
      organicTrafficEstimate: 30000,
      organicKeywordCount: 500,
      topKeywords: [{ keyword: 'test kw', searchVolume: 500, position: 1 }],
    });

    // First call — goes through service
    await request(app)
      .get(`/api/projects/${testProject._id}/domain-overview`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Change mock return so second call would differ if not cached
    mockGetDomainOverview.mockResolvedValue({
      organicTrafficEstimate: 99999,
      organicKeywordCount: 999,
      topKeywords: [],
    });

    // Second call — should hit snapshot cache
    const res2 = await request(app)
      .get(`/api/projects/${testProject._id}/domain-overview`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Must be the original cached value, not the new mock
    expect(res2.body.organicTrafficEstimate).toBe(30000);
    expect(res2.body.organicKeywordCount).toBe(500);
  });

  it('returns 403 for non-owner project', async () => {
    const otherUser = await User.create({
      email: 'other@test.com',
      passwordHash: '$2b$10$mockhash',
      role: 'developer',
      companyName: 'Other Co',
    });
    const otherOrg = await Organization.create({ name: 'Other Org', ownerId: otherUser._id });
    await Membership.create({ organizationId: otherOrg._id, userId: otherUser._id, role: 'owner', joinedAt: new Date() });
    const otherProject = await Project.create({
      name: 'Other',
      domain: 'other.com',
      organizationId: otherOrg._id,
    });

    await request(app)
      .get(`/api/projects/${otherProject._id}/domain-overview`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});

describe('Domain Overview — POST compare', () => {
  it('returns side-by-side comparison including own domain', async () => {
    mockGetDomainOverview.mockImplementation(async (_userId: string, domain: string) => {
      if (domain === 'example.com') {
        return { organicTrafficEstimate: 25000, organicKeywordCount: 450, topKeywords: [] };
      }
      if (domain === 'competitor1.com') {
        return { organicTrafficEstimate: 18000, organicKeywordCount: 300, topKeywords: [] };
      }
      if (domain === 'competitor2.com') {
        return { organicTrafficEstimate: 40000, organicKeywordCount: 700, topKeywords: [] };
      }
      throw new Error('Unknown domain');
    });

    const res = await request(app)
      .post(`/api/projects/${testProject._id}/domain-overview/compare`)
      .set('Authorization', `Bearer ${token}`)
      .send({ competitors: ['competitor1.com', 'competitor2.com'] })
      .expect(200);

    expect(res.body).toHaveProperty('comparison');
    expect(res.body.comparison).toHaveLength(3);
    expect(res.body.comparison[0].domain).toBe('example.com');
    expect(res.body.comparison[0].organicTrafficEstimate).toBe(25000);
    expect(res.body.comparison[1].domain).toBe('competitor1.com');
    expect(res.body.comparison[1].organicTrafficEstimate).toBe(18000);
    expect(res.body.comparison[2].domain).toBe('competitor2.com');
    expect(res.body.comparison[2].organicTrafficEstimate).toBe(40000);
  });

  it('rejects more than 5 competitors', async () => {
    const res = await request(app)
      .post(`/api/projects/${testProject._id}/domain-overview/compare`)
      .set('Authorization', `Bearer ${token}`)
      .send({ competitors: ['a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com'] })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
  });
});
