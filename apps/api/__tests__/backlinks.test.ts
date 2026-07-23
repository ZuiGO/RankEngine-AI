import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

jest.setTimeout(60000);

// Mock BullMQ
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
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.DATAFORSEO_LOGIN = '';
process.env.DATAFORSEO_PASSWORD = '';

const Project = require('../src/models/Project').default || require('../src/models/Project').Project;

// We'll mock getBacklinkList to return deterministic data
const mockGetBacklinkList = jest.fn();

jest.mock('../src/services/dataProviderService', () => {
  const actual = jest.requireActual('../src/services/dataProviderService');
  return {
    ...actual,
    getBacklinkList: (...args: any[]) => mockGetBacklinkList(...args),
  };
});

const { app } = require('../src/app');

let testProject: any;

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

  testProject = await Project.create({
    name: 'Test Project',
    domain: 'example.com',
  });
});

describe('Backlinks — toxic flag', () => {
  it('marks backlinks as toxic when spamScore exceeds threshold or anchor matches spam pattern', async () => {
    mockGetBacklinkList.mockResolvedValue([
      {
        sourceUrl: 'https://good-site.com/article',
        targetUrl: 'https://example.com/page',
        anchorText: 'useful resource',
        firstSeen: '2025-01-15',
        spamScore: 10,
      },
      {
        sourceUrl: 'https://spammy-casino.com',
        targetUrl: 'https://example.com/page',
        anchorText: 'best casino bonuses',
        firstSeen: '2025-01-16',
        spamScore: 30,
      },
      {
        sourceUrl: 'https://pharma-pills.com',
        targetUrl: 'https://example.com/page',
        anchorText: 'cheap viagra online',
        firstSeen: '2025-01-17',
        spamScore: 5,
      },
      {
        sourceUrl: 'https://high-spam-score.com',
        targetUrl: 'https://example.com/page',
        anchorText: 'normal anchor text',
        firstSeen: '2025-01-18',
        spamScore: 85,
      },
      {
        sourceUrl: 'https://borderline.com',
        targetUrl: 'https://example.com/page',
        anchorText: 'click here for info',
        firstSeen: '2025-01-19',
        spamScore: 45,
      },
    ]);

    const res = await request(app)
      .get(`/api/projects/${testProject._id}/backlinks/list?page=1&limit=100`)
      .expect(200);

    expect(res.body).toHaveProperty('items');
    expect(res.body.items).toHaveLength(5);

    // spamScore 10, normal anchor → NOT toxic
    expect(res.body.items[0].toxic).toBe(false);

    // spamScore 30, but anchor "best casino bonuses" matches "casino" → TOXIC
    expect(res.body.items[1].toxic).toBe(true);

    // spamScore 5, but anchor "cheap viagra online" matches "viagra" → TOXIC
    expect(res.body.items[2].toxic).toBe(true);

    // spamScore 85 > 60 → TOXIC
    expect(res.body.items[3].toxic).toBe(true);

    // spamScore 45, "click here" matches pattern → TOXIC
    expect(res.body.items[4].toxic).toBe(true);
  });

  it('returns overview with snapshot caching', async () => {
    // First call — no snapshot, goes via service
    const res1 = await request(app)
      .get(`/api/projects/${testProject._id}/backlinks/overview`)
      .expect(200);

    expect(res1.body).toHaveProperty('totalBacklinks');
    expect(res1.body).toHaveProperty('referringDomains');
    expect(res1.body).toHaveProperty('authorityScore');
    expect(typeof res1.body.totalBacklinks).toBe('number');

    // Second call should hit snapshot cache with same data shape
    const res2 = await request(app)
      .get(`/api/projects/${testProject._id}/backlinks/overview`)
      .expect(200);

    expect(res2.body).toHaveProperty('totalBacklinks');
    expect(res2.body).toHaveProperty('referringDomains');
    expect(res2.body).toHaveProperty('authorityScore');
  });
});
