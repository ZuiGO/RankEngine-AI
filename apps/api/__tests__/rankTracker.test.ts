import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Project } from '../src/models/Project';
import { TrackedKeyword } from '../src/models/TrackedKeyword';
import { RankSnapshot } from '../src/models/RankSnapshot';

let mongoServer: MongoMemoryServer;

// Mock BullMQ
jest.mock('bullmq', () => {
  return {
    Queue: jest.fn(),
    Worker: jest.fn(),
    QueueEvents: jest.fn(),
  };
});

process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_rank_tracker';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

const { collectAllRankSnapshots } = require('../src/services/rankTrackerService');

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

describe('Rank Tracker Scheduled Job', () => {
  let project1: any;

  beforeEach(async () => {
    await Project.deleteMany({});
    await TrackedKeyword.deleteMany({});
    await RankSnapshot.deleteMany({});

    project1 = new Project({
      name: 'Search Tech Project',
      ownerId: new mongoose.Types.ObjectId(),
      domain: 'https://searchtech.com',
    });
    await project1.save();
  });

  it('should collect exactly one RankSnapshot per TrackedKeyword on run', async () => {
    // 1. Create two tracked keywords
    const kw1 = new TrackedKeyword({
      projectId: project1._id,
      keyword: 'seo tool',
      targetUrl: 'https://searchtech.com/seo-tool',
      competitorDomains: ['comp1.com'],
    });

    const kw2 = new TrackedKeyword({
      projectId: project1._id,
      keyword: 'schema checker',
      targetUrl: 'https://searchtech.com/checker',
      competitorDomains: ['comp2.com'],
    });

    await kw1.save();
    await kw2.save();

    // Verify initially zero snapshots exist
    let snapsCount = await RankSnapshot.countDocuments({});
    expect(snapsCount).toBe(0);

    // 2. Execute scheduled rank collector job
    await collectAllRankSnapshots();

    // 3. Verify exactly 2 snapshots were created (one for each keyword)
    snapsCount = await RankSnapshot.countDocuments({});
    expect(snapsCount).toBe(2);

    const snapshot1 = await RankSnapshot.findOne({ keywordId: kw1._id });
    const snapshot2 = await RankSnapshot.findOne({ keywordId: kw2._id });

    expect(snapshot1).toBeDefined();
    expect(snapshot1?.projectId.toString()).toBe(project1._id.toString());
    expect(snapshot1?.position).toBeGreaterThan(0);
    expect(snapshot1?.position).toBeLessThan(102);

    expect(snapshot2).toBeDefined();
    expect(snapshot2?.projectId.toString()).toBe(project1._id.toString());
    expect(snapshot2?.position).toBeGreaterThan(0);
    expect(snapshot2?.position).toBeLessThan(102);

    // Check date boundaries (UTC midnight)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    expect(snapshot1?.date.getTime()).toBe(today.getTime());
    expect(snapshot2?.date.getTime()).toBe(today.getTime());
  });

  it('should override snapshot details with upsert on double runs on same day', async () => {
    const kw1 = new TrackedKeyword({
      projectId: project1._id,
      keyword: 'seo tool',
      targetUrl: 'https://searchtech.com/seo-tool',
    });
    await kw1.save();

    // Execute first run
    await collectAllRankSnapshots();
    let snapsCount = await RankSnapshot.countDocuments({});
    expect(snapsCount).toBe(1);

    // Execute second run on the same day (should update existing snapshot rather than insert a new one)
    await collectAllRankSnapshots();
    snapsCount = await RankSnapshot.countDocuments({});
    expect(snapsCount).toBe(1); // Still exactly one snapshot!
  });
});
