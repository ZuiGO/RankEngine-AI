import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Project } from '../src/models/Project';
import { TrackedKeyword } from '../src/models/TrackedKeyword';
import { RankSnapshot } from '../src/models/RankSnapshot';
import { Notification } from '../src/models/Notification';

let mongoServer: MongoMemoryServer;

// Mock BullMQ so worker queues don't error out
jest.mock('bullmq', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
  QueueEvents: jest.fn(),
}));

// Seed env BEFORE any require() calls that import config.ts
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_competitor_alerts';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';
process.env.SERP_API_PROVIDER = process.env.SERP_API_PROVIDER || 'mock';
process.env.SERP_API_KEY = process.env.SERP_API_KEY || 'mock-serp-key';
process.env.LLM_API_KEY = process.env.LLM_API_KEY || 'mock-llm-key';

// Override the email service BEFORE loading rankTrackerService
jest.mock('../src/services/emailService', () => {
  const singleton = {
    sendEmail: async (to: string, subject: string, body: string) => {
      // emailCalls is closed over from the outer scope via module-level hoisting;
      // we push via a global key so the factory closure can reach it.
      (global as any).__emailCalls = (global as any).__emailCalls ?? [];
      (global as any).__emailCalls.push({ to, subject, body });
      return true;
    },
  };
  return {
    ConsoleEmailService: jest.fn(() => singleton),
    getEmailService: () => singleton,
    _setEmailService: jest.fn(),
  };
});

// We'll override the SERP provider to return controlled results per test
let mockSerpResults: Array<{ url: string; title: string }> = [];

jest.mock('../src/services/serpService', () => ({
  getSerpProvider: () => ({
    fetchTop10: jest.fn(async () => mockSerpResults),
  }),
}));

// Lazy require AFTER env + mocks are set up
const { collectRankSnapshotForKeyword } = require('../src/services/rankTrackerService');

const TARGET_URL = 'https://mysite.com';
const COMPETITOR = 'competitor.com';
const KEYWORD = 'seo best practices';

// Helper: build ordered SERP result array
function buildSerp(positions: { url: string; pos: number }[]): { url: string; title: string }[] {
  const arr: { url: string; title: string }[] = Array(10)
    .fill(null)
    .map((_, i) => ({ url: `https://filler${i}.com`, title: `Filler ${i}` }));
  for (const { url, pos } of positions) {
    arr[pos - 1] = { url, title: url };
  }
  return arr;
}

// User stub shared across tests
let userId: mongoose.Types.ObjectId;
let projectId: mongoose.Types.ObjectId;
let keywordId: mongoose.Types.ObjectId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  // Create a stub User with email so the alert path can find it
  const User = mongoose.model(
    'User',
    new mongoose.Schema({ email: String, name: String, password: String, role: String })
  );
  const user = await User.create({
    email: 'owner@example.com',
    name: 'Test Owner',
    password: 'hashed',
    role: 'user',
  });
  userId = user._id as mongoose.Types.ObjectId;

  // Create project
  const project = await Project.create({
    name: 'Test Project',
    ownerId: userId,
    domain: 'mysite.com',
  });
  projectId = project._id as mongoose.Types.ObjectId;

  // Create tracked keyword with competitor
  const kw = await TrackedKeyword.create({
    projectId,
    keyword: KEYWORD,
    targetUrl: TARGET_URL,
    competitorDomains: [COMPETITOR],
  });
  keywordId = kw._id as mongoose.Types.ObjectId;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  // Clear snaps and notifications between tests
  await RankSnapshot.deleteMany({});
  await Notification.deleteMany({});
  (global as any).__emailCalls = [];
});

// ─── Seed a "yesterday" snapshot with competitor at position 10 ──────────────
async function seedYesterdaySnapshot(competitorPosition: number) {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);

  await RankSnapshot.create({
    keywordId,
    projectId,
    position: 3,
    aioPresence: false,
    competitors: [{ domain: COMPETITOR, position: competitorPosition }],
    date: yesterday,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Competitor moves up EXACTLY 4 spots (10 → 6) → alert FIRES
// ─────────────────────────────────────────────────────────────────────────────
it('fires notification + email when competitor improves by exactly 4 positions', async () => {
  // Previous snapshot: competitor was at #10
  await seedYesterdaySnapshot(10);

  // Today's SERP: target at #3, competitor at #6 (moved from 10 → 6 = +4 spots)
  mockSerpResults = buildSerp([
    { url: TARGET_URL, pos: 3 },
    { url: `https://${COMPETITOR}/page`, pos: 6 },
  ]);

  await collectRankSnapshotForKeyword(
    projectId.toString(),
    keywordId.toString(),
    KEYWORD,
    TARGET_URL,
    [COMPETITOR]
  );

  const notifications = await Notification.find({ userId });
  expect(notifications).toHaveLength(1);
  expect(notifications[0].message).toMatch(/jumped 4 positions/i);
  expect(notifications[0].read).toBe(false);

  // Email should have fired once
  const emails: { to: string; subject: string; body: string }[] =
    (global as any).__emailCalls ?? [];
  expect(emails).toHaveLength(1);
  expect(emails[0].to).toBe('owner@example.com');
  expect(emails[0].subject).toContain(KEYWORD);
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Competitor moves up only 2 spots (10 → 8) → alert does NOT fire
// ─────────────────────────────────────────────────────────────────────────────
it('does NOT fire notification or email when competitor improves by only 2 positions', async () => {
  // Previous snapshot: competitor was at #10
  await seedYesterdaySnapshot(10);

  // Today's SERP: competitor at #8 (moved from 10 → 8 = +2 spots, below threshold)
  mockSerpResults = buildSerp([
    { url: TARGET_URL, pos: 3 },
    { url: `https://${COMPETITOR}/page`, pos: 8 },
  ]);

  await collectRankSnapshotForKeyword(
    projectId.toString(),
    keywordId.toString(),
    KEYWORD,
    TARGET_URL,
    [COMPETITOR]
  );

  const notifications = await Notification.find({ userId });
  expect(notifications).toHaveLength(0);
  expect((global as any).__emailCalls ?? []).toHaveLength(0);
});
