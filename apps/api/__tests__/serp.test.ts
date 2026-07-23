import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';
import axios from 'axios';

let mongoServer: MongoMemoryServer;

// Mock Axios calls for competitor content fetching
jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    ...actual,
    get: jest.fn(),
    post: jest.fn(),
  };
});

// Mock BullMQ
jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation(() => ({
      add: jest.fn(),
      close: jest.fn(),
    })),
    Worker: jest.fn(),
    QueueEvents: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      close: jest.fn(),
    })),
  };
});

process.env.MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_serp_analysis_api';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

const app = require('../src/app').default;
const { SerpAnalysis } = require('../src/models/SerpAnalysis');
const serpService = require('../src/services/serpService');

const request = supertest(app);

let userToken: string;
let userId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  // Register User
  const res = await request
    .post('/api/auth/register')
    .send({
      email: 'serp-user@rankengine.ai',
      password: 'password123',
      role: 'agency_owner',
      companyName: 'Serp Agency',
    })
    .expect(201);
  userToken = res.body.token;
  userId = res.body.user.id;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('SERP Analysis API', () => {
  let spySerp: jest.SpyInstance;
  let spyLlm: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock axios.get for competitor fetches
    (axios.get as jest.Mock).mockResolvedValue({
      data: `
        <html>
          <head><title>Mock Comp Title</title></head>
          <body>
            <h1>Ranking high</h1>
            <p>Word count check optimized ranking keywords.</p>
          </body>
        </html>
      `,
      status: 200,
    });

    // Mock SERP provider top 10 results
    spySerp = jest.spyOn(serpService.MockSerpProvider.prototype, 'fetchTop10').mockResolvedValue([
      { url: 'https://comp1.com/page', title: 'Competitor 1 Title' },
      { url: 'https://comp2.com/page', title: 'Competitor 2 Title' },
    ]);

    // Mock LLM shared topics/entities synthesis
    spyLlm = jest.spyOn(serpService, 'analyzeSerpContentWithLlm').mockResolvedValue({
      sharedEntities: ['SEO Keyword', 'Rank Tracker'],
      sharedSubtopics: ['Title tags optimization', 'Page speed improvement'],
    });
  });

  afterEach(async () => {
    spySerp.mockRestore();
    spyLlm.mockRestore();
    await SerpAnalysis.deleteMany({});
  });

  it('should run full analysis on cache miss and store findings in database', async () => {
    const res = await request
      .post('/api/content/serp-analysis')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ keyword: 'seo audit' })
      .expect(200);

    expect(res.body).toEqual({
      keyword: 'seo audit',
      avgWordCount: 8,
      sharedEntities: ['SEO Keyword', 'Rank Tracker'],
      sharedSubtopics: ['Title tags optimization', 'Page speed improvement'],
      competitors: [
        { url: 'https://comp1.com/page', title: 'Competitor 1 Title', wordCount: 8 },
        { url: 'https://comp2.com/page', title: 'Competitor 2 Title', wordCount: 8 },
      ],
    });

    expect(spySerp).toHaveBeenCalledTimes(1);
    expect(spyLlm).toHaveBeenCalledTimes(1);

    // Verify written to database
    const cached = await SerpAnalysis.findOne({ keyword: 'seo audit' });
    expect(cached).toBeDefined();
    expect(cached?.avgWordCount).toBe(8);
  });

  it('should hit cache on subsequent request for the same keyword within 24h', async () => {
    // 1. Run first request (populates cache)
    await request
      .post('/api/content/serp-analysis')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ keyword: 'seo audit' })
      .expect(200);

    expect(spySerp).toHaveBeenCalledTimes(1);
    expect(spyLlm).toHaveBeenCalledTimes(1);

    // Reset call counts on spies to verify cache behavior
    spySerp.mockClear();
    spyLlm.mockClear();

    // 2. Run second request (should hit cache)
    const res = await request
      .post('/api/content/serp-analysis')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ keyword: 'seo audit' })
      .expect(200);

    expect(res.body.keyword).toBe('seo audit');
    expect(res.body.avgWordCount).toBe(8);

    // Providers should not be hit on cache hit
    expect(spySerp).toHaveBeenCalledTimes(0);
    expect(spyLlm).toHaveBeenCalledTimes(0);
  });

  it('should reject requests without authorization token', async () => {
    await request.post('/api/content/serp-analysis').send({ keyword: 'seo audit' }).expect(401);
  });

  it('should reject empty keyword parameters', async () => {
    await request
      .post('/api/content/serp-analysis')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ keyword: '   ' })
      .expect(400);
  });
});
