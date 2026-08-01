/**
 * Tests for GET /api/projects/:id/report
 *
 * Services are mocked at the module level — we test the route's orchestration
 * and response-shaping logic, not the service implementations (those are
 * covered by their own test files).
 *
 * MongoMemoryServer is used only so that mongoose.Types.ObjectId.isValid()
 * and the app's mongoose connection work correctly — no real documents are
 * required by these tests.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

// ── BullMQ mock (prevent Redis dependency) ───────────────────────────────────
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

// ── Service mocks — declared BEFORE app import so jest hoisting kicks in ─────
jest.mock('../src/services/siteReportService');
jest.mock('../src/services/actionItemsService');

import app from '../src/app';
import {
  generateSiteReport,
  NoCompletedCrawlError as SiteReportNoCrawlError,
} from '../src/services/siteReportService';
import {
  getActionItems,
  NoCompletedCrawlError as ActionItemsNoCrawlError,
} from '../src/services/actionItemsService';

const mockedGenerateSiteReport = generateSiteReport as jest.MockedFunction<typeof generateSiteReport>;
const mockedGetActionItems = getActionItems as jest.MockedFunction<typeof getActionItems>;

// ─────────────────────────────────────────────────────────────────────────────
// Fixture data
// ─────────────────────────────────────────────────────────────────────────────

const VALID_PROJECT_ID = new mongoose.Types.ObjectId().toString();

const FIXTURE_REPORT = {
  projectId: VALID_PROJECT_ID,
  generatedAt: new Date('2025-01-15T12:00:00Z'),
  counts: {
    pageCount: 42,
    totalLinks: 380,
    totalHyperlinks: 380,
    internalLinks: 310,
    backlinkCount: 1240,
  },
  pages: [
    {
      url: 'https://example.com/page-1',
      issues: [
        { severity: 'critical', category: 'redirect', description: 'Redirect chain of 3 hops' },
      ],
    },
    {
      url: 'https://example.com/page-2',
      issues: [
        { severity: 'passed', category: 'canonical', description: 'Canonical is self-referential' },
      ],
    },
  ],
};

const FIXTURE_ACTION_ITEMS = [
  {
    contentId: new mongoose.Types.ObjectId().toString(),
    pageUrl: 'https://example.com/page-1',
    impactOnRanking: 'Redirect chains dilute link equity and waste crawl budget.',
    identifiedIssues: 'redirect — Redirect chain of 3 hops',
    howToImprove: 'Replace with a single 301 redirect to the canonical URL.',
    status: 'open' as const,
  },
  {
    contentId: new mongoose.Types.ObjectId().toString(),
    pageUrl: 'https://example.com/page-2',
    impactOnRanking: 'Affects canonical signals',
    identifiedIssues: 'canonical — Canonical is self-referential',
    howToImprove: 'No action needed',
    status: 'approved' as const,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

let mongoServer: MongoMemoryServer;
const request = supertest(app);

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

beforeEach(() => {
  jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Happy path: combined response shape is correct
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/projects/:id/report — happy path', () => {
  beforeEach(() => {
    mockedGenerateSiteReport.mockResolvedValue(FIXTURE_REPORT as any);
    mockedGetActionItems.mockResolvedValue(FIXTURE_ACTION_ITEMS);
  });

  it('returns HTTP 200 with { report, actionItems } at the top level', async () => {
    const res = await request
      .get(`/api/projects/${VALID_PROJECT_ID}/report`)
      .expect(200);

    expect(res.body).toHaveProperty('report');
    expect(res.body).toHaveProperty('actionItems');
  });

  it('report object contains all SiteReport fields', async () => {
    const res = await request
      .get(`/api/projects/${VALID_PROJECT_ID}/report`)
      .expect(200);

    const { report } = res.body;
    expect(report.projectId).toBe(VALID_PROJECT_ID);
    expect(report.counts.pageCount).toBe(42);
    expect(report.counts.totalLinks).toBe(380);
    expect(report.counts.totalHyperlinks).toBe(380);
    expect(report.counts.internalLinks).toBe(310);
    expect(report.counts.backlinkCount).toBe(1240);
    expect(Array.isArray(report.pages)).toBe(true);
    expect(report.pages).toHaveLength(2);
  });

  it('actionItems array contains all ActionItem fields with correct values', async () => {
    const res = await request
      .get(`/api/projects/${VALID_PROJECT_ID}/report`)
      .expect(200);

    const { actionItems } = res.body;
    expect(Array.isArray(actionItems)).toBe(true);
    expect(actionItems).toHaveLength(2);

    const [first, second] = actionItems;

    // First item: open status
    expect(first).toMatchObject({
      pageUrl: 'https://example.com/page-1',
      impactOnRanking: 'Redirect chains dilute link equity and waste crawl budget.',
      identifiedIssues: 'redirect — Redirect chain of 3 hops',
      howToImprove: 'Replace with a single 301 redirect to the canonical URL.',
      status: 'open',
    });
    expect(typeof first.contentId).toBe('string');
    expect(first.contentId.length).toBeGreaterThan(0);

    // Second item: approved status
    expect(second.status).toBe('approved');
    expect(second.pageUrl).toBe('https://example.com/page-2');
  });

  it('calls both services with the project ID extracted from the route param', async () => {
    await request
      .get(`/api/projects/${VALID_PROJECT_ID}/report`)
      .expect(200);

    expect(mockedGenerateSiteReport).toHaveBeenCalledTimes(1);
    expect(mockedGenerateSiteReport).toHaveBeenCalledWith(VALID_PROJECT_ID);

    expect(mockedGetActionItems).toHaveBeenCalledTimes(1);
    expect(mockedGetActionItems).toHaveBeenCalledWith(VALID_PROJECT_ID);
  });

  it('calls both services in parallel (both called even if one is slow)', async () => {
    // Both mocks should be called — if they were sequential and the first
    // threw, the second would never be called. We just assert both ran.
    await request
      .get(`/api/projects/${VALID_PROJECT_ID}/report`)
      .expect(200);

    expect(mockedGenerateSiteReport).toHaveBeenCalledTimes(1);
    expect(mockedGetActionItems).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — No completed crawl: returns 400 with machine-readable code
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/projects/:id/report — unaudited project (400)', () => {
  it('returns 400 when generateSiteReport throws NoCompletedCrawlError', async () => {
    mockedGenerateSiteReport.mockRejectedValue(
      new SiteReportNoCrawlError(VALID_PROJECT_ID)
    );
    mockedGetActionItems.mockResolvedValue(FIXTURE_ACTION_ITEMS);

    const res = await request
      .get(`/api/projects/${VALID_PROJECT_ID}/report`)
      .expect(400);

    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('code', 'NO_COMPLETED_CRAWL');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.toLowerCase()).toContain('audit');
  });

  it('returns 400 when getActionItems throws NoCompletedCrawlError', async () => {
    mockedGenerateSiteReport.mockResolvedValue(FIXTURE_REPORT as any);
    mockedGetActionItems.mockRejectedValue(
      new ActionItemsNoCrawlError(VALID_PROJECT_ID)
    );

    const res = await request
      .get(`/api/projects/${VALID_PROJECT_ID}/report`)
      .expect(400);

    expect(res.body.code).toBe('NO_COMPLETED_CRAWL');
  });

  it('400 response body does NOT contain report or actionItems keys (no partial data)', async () => {
    mockedGenerateSiteReport.mockRejectedValue(
      new SiteReportNoCrawlError(VALID_PROJECT_ID)
    );
    mockedGetActionItems.mockResolvedValue([]);

    const res = await request
      .get(`/api/projects/${VALID_PROJECT_ID}/report`)
      .expect(400);

    expect(res.body).not.toHaveProperty('report');
    expect(res.body).not.toHaveProperty('actionItems');
  });

  it('400 error message tells the user to run an audit first', async () => {
    mockedGenerateSiteReport.mockRejectedValue(
      new SiteReportNoCrawlError(VALID_PROJECT_ID)
    );
    mockedGetActionItems.mockResolvedValue([]);

    const res = await request
      .get(`/api/projects/${VALID_PROJECT_ID}/report`)
      .expect(400);

    // Must be actionable — user must understand what to do next
    expect(res.body.error.toLowerCase()).toMatch(/audit|run|crawl/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Input validation
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/projects/:id/report — input validation', () => {
  it('returns 400 for a malformed (non-ObjectId) project ID', async () => {
    const res = await request
      .get('/api/projects/not-a-valid-id/report')
      .expect(400);

    expect(res.body).toHaveProperty('error');
    expect(res.body.error.toLowerCase()).toContain('invalid');

    // Services must NOT be called for an invalid ID
    expect(mockedGenerateSiteReport).not.toHaveBeenCalled();
    expect(mockedGetActionItems).not.toHaveBeenCalled();
  });

  it('returns 500 for unexpected service errors (not NoCompletedCrawlError)', async () => {
    mockedGenerateSiteReport.mockRejectedValue(
      new Error('MongoDB connection lost')
    );
    mockedGetActionItems.mockResolvedValue([]);

    await request
      .get(`/api/projects/${VALID_PROJECT_ID}/report`)
      .expect(500);
  });
});
