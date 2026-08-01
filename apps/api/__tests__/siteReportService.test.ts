/**
 * Unit / integration tests for siteReportService.generateSiteReport()
 *
 * These tests use MongoMemoryServer to exercise the real Mongoose models and
 * mock only the native MongoDB driver's db.collection() call (used for the
 * raw `crawlresults` collection that is not managed by a Mongoose model).
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

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

import { CrawlJob } from '../src/models/CrawlJob';
import { AuditIssue } from '../src/models/AuditIssue';
import { BacklinkSnapshot } from '../src/models/BacklinkSnapshot';
import {
  generateSiteReport,
  NoCompletedCrawlError,
} from '../src/services/siteReportService';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stub mongoose.connection.db.collection() so the service can query the
 * `crawlresults` collection without a real MongoDB collection existing in the
 * in-memory server (the collection is managed by the Python worker, not
 * Mongoose, so no Mongoose model exists for it).
 */
function stubCrawlResultsCollection(doc: Record<string, any> | null) {
  const mockCollection = {
    findOne: jest.fn().mockResolvedValue(doc),
  };
  Object.defineProperty(mongoose.connection, 'db', {
    get: jest.fn(() => ({
      collection: jest.fn(() => mockCollection),
    })),
    configurable: true,
  });
  return mockCollection;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

let mongoServer: MongoMemoryServer;

// Stable ObjectIds for fixture data
const PROJECT_ID = new mongoose.Types.ObjectId();
const CRAWL_JOB_ID = new mongoose.Types.ObjectId();
const CRAWL_RESULT_ID = new mongoose.Types.ObjectId();

const OTHER_PROJECT_ID = new mongoose.Types.ObjectId();

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

afterEach(() => {
  // Restore db property after each test so stubs don't bleed between tests
  try {
    delete (mongoose.connection as any).db;
  } catch {
    /* ignore if non-configurable */
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Happy path: returns exact counts from fixture data
// ─────────────────────────────────────────────────────────────────────────────

describe('generateSiteReport — happy path', () => {
  beforeAll(async () => {
    // ── Fixture: completed CrawlJob ─────────────────────────────────────────
    await CrawlJob.create({
      _id: CRAWL_JOB_ID,
      projectId: PROJECT_ID,
      status: 'completed',
      type: 'crawl',
      pageCount: 3,
      rawResultsRef: CRAWL_RESULT_ID.toString(),
      completedAt: new Date('2025-01-15T12:00:00Z'),
    });

    // ── Fixture: AuditIssues (2 URLs × mixed severities) ───────────────────
    // page-1: 1 critical, 1 warning
    // page-2: 2 passed
    // N/A: 1 critical (URL-less issue, e.g. site-wide schema problem)
    await AuditIssue.create([
      {
        crawlJobId: CRAWL_JOB_ID,
        severity: 'critical',
        category: 'redirect',
        url: 'https://example.com/page-1',
        description: 'Redirect chain detected',
        recommendation: 'Shorten redirect chain',
      },
      {
        crawlJobId: CRAWL_JOB_ID,
        severity: 'warning',
        category: 'meta',
        url: 'https://example.com/page-1',
        description: 'Meta description too short',
        recommendation: 'Expand meta description to 120+ characters',
      },
      {
        crawlJobId: CRAWL_JOB_ID,
        severity: 'passed',
        category: 'headings',
        url: 'https://example.com/page-2',
        description: 'H1 present and well-formed',
        recommendation: 'No action needed',
      },
      {
        crawlJobId: CRAWL_JOB_ID,
        severity: 'passed',
        category: 'canonical',
        url: 'https://example.com/page-2',
        description: 'Canonical URL is self-referential',
        recommendation: 'No action needed',
      },
      {
        crawlJobId: CRAWL_JOB_ID,
        severity: 'critical',
        category: 'schema',
        url: 'N/A',
        description: 'Missing JSON-LD structured data site-wide',
        recommendation: 'Add Organization schema to homepage',
      },
    ]);

    // ── Fixture: BacklinkSnapshot ────────────────────────────────────────────
    await BacklinkSnapshot.create({
      projectId: PROJECT_ID,
      date: '2025-01-15',
      totalBacklinks: 1_240,
      referringDomains: 87,
      authorityScore: 42,
      cachedAt: new Date(),
    });
  });

  afterAll(async () => {
    // Clean up fixture data so tests don't interfere with each other
    await CrawlJob.deleteMany({ projectId: PROJECT_ID });
    await AuditIssue.deleteMany({ crawlJobId: CRAWL_JOB_ID });
    await BacklinkSnapshot.deleteMany({ projectId: PROJECT_ID });
  });

  it('returns a SiteReport whose shape exactly matches the interface contract', async () => {
    // Fixture crawlresults document: 3 pages with known link counts
    // page-1: 5 internal + 2 external = 7
    // page-2: 3 internal + 1 external = 4
    // page-3: 10 internal + 0 external = 10
    // totals: internalLinks = 18, totalLinks = 21
    const crawlResultDoc = {
      _id: CRAWL_RESULT_ID,
      crawlJobId: CRAWL_JOB_ID,
      pages: [
        { url: 'https://example.com/page-1', internalLinkCount: 5, externalLinkCount: 2 },
        { url: 'https://example.com/page-2', internalLinkCount: 3, externalLinkCount: 1 },
        { url: 'https://example.com/page-3', internalLinkCount: 10, externalLinkCount: 0 },
      ],
    };
    stubCrawlResultsCollection(crawlResultDoc);

    const report = await generateSiteReport(PROJECT_ID.toString());

    // ── Shape checks ────────────────────────────────────────────────────────
    expect(report).toMatchObject({
      projectId: PROJECT_ID.toString(),
      generatedAt: expect.any(Date),
    });

    // ── Counts ──────────────────────────────────────────────────────────────
    expect(report.counts.pageCount).toBe(3);
    expect(report.counts.internalLinks).toBe(18);   // 5 + 3 + 10
    expect(report.counts.totalLinks).toBe(21);       // 7 + 4 + 10
    expect(report.counts.totalHyperlinks).toBe(21);  // same as totalLinks (no separate distinction in crawler)
    expect(report.counts.backlinkCount).toBe(1_240); // from BacklinkSnapshot

    // ── Pages ───────────────────────────────────────────────────────────────
    // 3 distinct URLs from AuditIssues: page-1, page-2, N/A
    expect(report.pages).toHaveLength(3);

    const page1 = report.pages.find(p => p.url === 'https://example.com/page-1');
    expect(page1).toBeDefined();
    expect(page1!.issues).toHaveLength(2);
    expect(page1!.issues.map(i => i.severity).sort()).toEqual(['critical', 'warning']);

    const page2 = report.pages.find(p => p.url === 'https://example.com/page-2');
    expect(page2).toBeDefined();
    expect(page2!.issues).toHaveLength(2);
    expect(page2!.issues.every(i => i.severity === 'passed')).toBe(true);

    const pageNa = report.pages.find(p => p.url === 'N/A');
    expect(pageNa).toBeDefined();
    expect(pageNa!.issues).toHaveLength(1);
    expect(pageNa!.issues[0].severity).toBe('critical');
    expect(pageNa!.issues[0].category).toBe('schema');
  });

  it('each issue in pages has severity, category, and description — no undefined fields', async () => {
    stubCrawlResultsCollection({ pages: [] }); // link counts irrelevant for this assertion

    const report = await generateSiteReport(PROJECT_ID.toString());

    for (const page of report.pages) {
      expect(typeof page.url).toBe('string');
      for (const issue of page.issues) {
        expect(['critical', 'warning', 'passed']).toContain(issue.severity);
        expect(typeof issue.category).toBe('string');
        expect(issue.category.length).toBeGreaterThan(0);
        expect(typeof issue.description).toBe('string');
        expect(issue.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses the most recent BacklinkSnapshot when multiple snapshots exist', async () => {
    // Insert an older snapshot with different totalBacklinks
    await BacklinkSnapshot.create({
      projectId: PROJECT_ID,
      date: '2024-12-01', // earlier date
      totalBacklinks: 500,
      referringDomains: 40,
      authorityScore: 30,
      cachedAt: new Date('2024-12-01'),
    });

    stubCrawlResultsCollection({ pages: [] });

    const report = await generateSiteReport(PROJECT_ID.toString());
    // Should pick the 2025-01-15 snapshot (totalBacklinks: 1240), not the older one
    expect(report.counts.backlinkCount).toBe(1_240);
  });

  it('returns backlinkCount of 0 when no BacklinkSnapshot exists for the project', async () => {
    // OTHER_PROJECT_ID has no BacklinkSnapshot and no crawl job yet —
    // create a crawl job for it so the service gets past the NoCompletedCrawlError
    const otherJob = await CrawlJob.create({
      projectId: OTHER_PROJECT_ID,
      status: 'completed',
      type: 'crawl',
      pageCount: 1,
      rawResultsRef: new mongoose.Types.ObjectId().toString(),
      completedAt: new Date(),
    });

    stubCrawlResultsCollection({ pages: [{ url: 'https://other.com', internalLinkCount: 2, externalLinkCount: 1 }] });

    const report = await generateSiteReport(OTHER_PROJECT_ID.toString());
    expect(report.counts.backlinkCount).toBe(0);

    await CrawlJob.deleteOne({ _id: otherJob._id });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — No completed crawl: throws a clear, typed error
// ─────────────────────────────────────────────────────────────────────────────

describe('generateSiteReport — no completed crawl', () => {
  const UNAUDITED_PROJECT_ID = new mongoose.Types.ObjectId();

  it('throws NoCompletedCrawlError (not a report full of zeros) when no crawl job exists', async () => {
    await expect(
      generateSiteReport(UNAUDITED_PROJECT_ID.toString())
    ).rejects.toThrow(NoCompletedCrawlError);
  });

  it('NoCompletedCrawlError message names the project and tells user to run an audit', async () => {
    try {
      await generateSiteReport(UNAUDITED_PROJECT_ID.toString());
      fail('Expected NoCompletedCrawlError to be thrown');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(NoCompletedCrawlError);
      const error = err as NoCompletedCrawlError;
      expect(error.name).toBe('NoCompletedCrawlError');
      expect(error.message).toContain(UNAUDITED_PROJECT_ID.toString());
      expect(error.message.toLowerCase()).toContain('audit');
    }
  });

  it('does NOT throw when a crawl job exists but is only queued or running', async () => {
    // A non-completed job must not satisfy the query — the project is still
    // unaudited and should throw NoCompletedCrawlError.
    await CrawlJob.create({
      projectId: UNAUDITED_PROJECT_ID,
      status: 'running',
      type: 'crawl',
      pageCount: 4,
    });

    await expect(
      generateSiteReport(UNAUDITED_PROJECT_ID.toString())
    ).rejects.toThrow(NoCompletedCrawlError);
  });

  it('does NOT use migration-check jobs — only standard crawl jobs count', async () => {
    const MIGRATION_ONLY_PROJECT_ID = new mongoose.Types.ObjectId();

    // Create only a completed migration-check job (not a standard crawl)
    await CrawlJob.create({
      projectId: MIGRATION_ONLY_PROJECT_ID,
      status: 'completed',
      type: 'migration-check',
      pageCount: 10,
      completedAt: new Date(),
    });

    await expect(
      generateSiteReport(MIGRATION_ONLY_PROJECT_ID.toString())
    ).rejects.toThrow(NoCompletedCrawlError);
  });
});
