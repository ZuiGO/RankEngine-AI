import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

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

process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_placeholder';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';
process.env.DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN || '';
process.env.DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD || '';

const { User } = require('../src/models/User');
const KeywordDataCache = require('../src/models/KeywordDataCache').default;
const BacklinkDataCache = require('../src/models/BacklinkDataCache').default;
const DomainOverviewCache = require('../src/models/DomainOverviewCache').default;

const {
  getKeywordData,
  getKeywordIdeas,
  getBacklinkOverview,
  getBacklinkList,
  getDomainOverview,
  DataProviderQuotaError,
  checkAndIncrementQuota,
} = require('../src/services/dataProviderService');

let testUser: any;

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
    email: 'test@example.com',
    passwordHash: '$2b$10$mockhash',
    role: 'agency_owner',
    companyName: 'Test Co',
    dataProviderCallsThisMonth: 0,
    dataProviderMonthlyLimit: 500,
    dataProviderQuotaResetAt: new Date(Date.UTC(2099, 0, 1)),
  });
});

// ── Quota tests ─────────────────────────────────────────────────────────────

describe('Quota system', () => {
  it('increments quota on non-cache-hit calls', async () => {
    const user = await User.findById(testUser._id);
    expect(user!.dataProviderCallsThisMonth).toBe(0);

    await checkAndIncrementQuota(testUser._id.toString(), 'keyword', false);

    const updated = await User.findById(testUser._id);
    expect(updated!.dataProviderCallsThisMonth).toBe(1);
  });

  it('does NOT increment quota on cache hits', async () => {
    await checkAndIncrementQuota(testUser._id.toString(), 'keyword', true);

    const user = await User.findById(testUser._id);
    expect(user!.dataProviderCallsThisMonth).toBe(0);
  });

  it('throws QuotaExceeded when over limit', async () => {
    await User.findByIdAndUpdate(testUser._id, {
      dataProviderCallsThisMonth: 500,
      dataProviderMonthlyLimit: 500,
    });

    await expect(checkAndIncrementQuota(testUser._id.toString(), 'keyword', false)).rejects.toThrow(
      DataProviderQuotaError
    );
  });

  it('auto-resets quota when reset date has passed', async () => {
    await User.findByIdAndUpdate(testUser._id, {
      dataProviderCallsThisMonth: 500,
      dataProviderMonthlyLimit: 500,
      dataProviderQuotaResetAt: new Date('2020-01-01'),
    });

    await checkAndIncrementQuota(testUser._id.toString(), 'keyword', false);

    const user = await User.findById(testUser._id);
    expect(user!.dataProviderCallsThisMonth).toBe(1);
    expect(user!.dataProviderQuotaResetAt.getTime()).toBeGreaterThan(Date.now());
  });
});

// ── Caching tests ──────────────────────────────────────────────────────────

describe('Caching', () => {
  it('returns cached keyword data without calling provider', async () => {
    await KeywordDataCache.create({
      cacheKey: `keyword:seo audit:2840`,
      dateBucket: new Date().toISOString().split('T')[0],
      keyword: 'seo audit',
      searchVolume: 5000,
      difficulty: 45,
      cpc: 3.5,
      intent: 'commercial',
      relatedKeywords: ['seo audit tools', 'seo audit checklist'],
      cachedAt: new Date(),
    });

    const userBefore = await User.findById(testUser._id);
    expect(userBefore!.dataProviderCallsThisMonth).toBe(0);

    const result = await getKeywordData(testUser._id.toString(), 'seo audit', '2840');

    expect(result.searchVolume).toBe(5000);
    expect(result.difficulty).toBe(45);

    const userAfter = await User.findById(testUser._id);
    expect(userAfter!.dataProviderCallsThisMonth).toBe(0);
  });

  it('returns cached backlink overview without calling provider', async () => {
    await BacklinkDataCache.create({
      cacheKey: 'bloverview:example.com',
      dateBucket: new Date().toISOString().split('T')[0],
      domain: 'example.com',
      totalBacklinks: 1000,
      referringDomains: 50,
      domainRating: 45,
      cachedAt: new Date(),
    });

    const result = await getBacklinkOverview(testUser._id.toString(), 'example.com');

    expect(result.totalBacklinks).toBe(1000);
    expect(result.referringDomains).toBe(50);
    expect(result.domainRating).toBe(45);

    const userAfter = await User.findById(testUser._id);
    expect(userAfter!.dataProviderCallsThisMonth).toBe(0);
  });

  it('returns cached domain overview without calling provider', async () => {
    await DomainOverviewCache.create({
      cacheKey: 'domainoverview:example.com',
      dateBucket: new Date().toISOString().split('T')[0],
      domain: 'example.com',
      organicTrafficEstimate: 50000,
      organicKeywordCount: 1000,
      topKeywords: [
        { keyword: 'example seo', searchVolume: 1200, position: 3 },
        { keyword: 'example marketing', searchVolume: 800, position: 5 },
      ],
      cachedAt: new Date(),
    });

    const result = await getDomainOverview(testUser._id.toString(), 'example.com');

    expect(result.organicTrafficEstimate).toBe(50000);
    expect(result.organicKeywordCount).toBe(1000);
    expect(result.topKeywords).toHaveLength(2);

    const userAfter = await User.findById(testUser._id);
    expect(userAfter!.dataProviderCallsThisMonth).toBe(0);
  });

  it('bypasses stale cache and makes fresh call (incrementing quota)', async () => {
    const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await KeywordDataCache.create({
      cacheKey: 'keyword:stale keyword:2840',
      dateBucket: new Date().toISOString().split('T')[0],
      keyword: 'stale keyword',
      searchVolume: 100,
      difficulty: 10,
      cpc: 1.0,
      intent: 'informational',
      relatedKeywords: [],
      cachedAt: staleDate,
    });

    const userBefore = await User.findById(testUser._id);
    expect(userBefore!.dataProviderCallsThisMonth).toBe(0);

    const result = await getKeywordData(testUser._id.toString(), 'stale keyword', '2840');

    expect(result.searchVolume).toBeGreaterThanOrEqual(0);

    const userAfter = await User.findById(testUser._id);
    expect(userAfter!.dataProviderCallsThisMonth).toBe(1);
  });
});

// ── Mock provider data shape tests ─────────────────────────────────────────

describe('Mock provider data shapes', () => {
  it('getKeywordData returns correct shape', async () => {
    const result = await getKeywordData(testUser._id.toString(), 'seo tools', '2840');

    expect(result).toHaveProperty('searchVolume');
    expect(result).toHaveProperty('difficulty');
    expect(result).toHaveProperty('cpc');
    expect(result).toHaveProperty('intent');
    expect(result).toHaveProperty('relatedKeywords');
    expect(Array.isArray(result.relatedKeywords)).toBe(true);
    expect(typeof result.searchVolume).toBe('number');
    expect(typeof result.difficulty).toBe('number');
  });

  it('getBacklinkOverview returns correct shape', async () => {
    const result = await getBacklinkOverview(testUser._id.toString(), 'example.com');

    expect(result).toHaveProperty('totalBacklinks');
    expect(result).toHaveProperty('referringDomains');
    expect(result).toHaveProperty('domainRating');
    expect(typeof result.totalBacklinks).toBe('number');
  });

  it('getBacklinkList returns array of items', async () => {
    const result = await getBacklinkList(testUser._id.toString(), 'example.com', 5);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('sourceUrl');
    expect(result[0]).toHaveProperty('targetUrl');
    expect(result[0]).toHaveProperty('anchorText');
    expect(result[0]).toHaveProperty('firstSeen');
    expect(result[0]).toHaveProperty('spamScore');
  });

  it('getDomainOverview returns correct shape', async () => {
    const result = await getDomainOverview(testUser._id.toString(), 'example.com');

    expect(result).toHaveProperty('organicTrafficEstimate');
    expect(result).toHaveProperty('organicKeywordCount');
    expect(result).toHaveProperty('topKeywords');
    expect(Array.isArray(result.topKeywords)).toBe(true);
    if (result.topKeywords.length > 0) {
      expect(result.topKeywords[0]).toHaveProperty('keyword');
    }
    expect(typeof result.organicTrafficEstimate).toBe('number');
  });
});

// ── Quota + cache integration ──────────────────────────────────────────────

describe('Quota + cache integration', () => {
  it('blocked call (quota exceeded) never reaches external provider', async () => {
    await User.findByIdAndUpdate(testUser._id, {
      dataProviderCallsThisMonth: 500,
      dataProviderMonthlyLimit: 500,
    });

    await expect(getKeywordData(testUser._id.toString(), 'anything')).rejects.toThrow(
      DataProviderQuotaError
    );

    // Because quota throws before any provider call, no mock is needed here.
  });

  it('subsequent requests after block remain blocked until reset', async () => {
    await User.findByIdAndUpdate(testUser._id, {
      dataProviderCallsThisMonth: 500,
      dataProviderMonthlyLimit: 500,
    });

    await expect(getKeywordData(testUser._id.toString(), 'test')).rejects.toThrow(
      DataProviderQuotaError
    );

    await expect(getBacklinkOverview(testUser._id.toString(), 'example.com')).rejects.toThrow(
      DataProviderQuotaError
    );
  });
});

// ── Keyword Ideas caching + quota ──────────────────────────────────────────

describe('Keyword ideas cache + quota', () => {
  it('repeated identical query within cache TTL does not decrement quota twice', async () => {
    // First call — no cache, goes to provider, quota goes to 1
    const results1 = await getKeywordIdeas(testUser._id.toString(), 'seo tools', '2840');
    expect(Array.isArray(results1)).toBe(true);
    expect(results1.length).toBeGreaterThan(0);

    let user = await User.findById(testUser._id);
    expect(user!.dataProviderCallsThisMonth).toBe(1);

    // Second call — cache is fresh, should not increment quota
    const results2 = await getKeywordIdeas(testUser._id.toString(), 'seo tools', '2840');
    expect(results2).toEqual(results1);

    user = await User.findById(testUser._id);
    expect(user!.dataProviderCallsThisMonth).toBe(1);
  });
});
