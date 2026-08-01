/**
 * Tests for actionItemsService.getActionItems()
 *
 * Uses MongoMemoryServer for real Mongoose model round-trips.
 * No mocking of business logic — all assertions are against the actual
 * field-mapping rules documented in the service.
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
import { PageContent } from '../src/models/PageContent';
import { PendingChange } from '../src/models/PendingChange';
import {
  getActionItems,
  NoCompletedCrawlError,
} from '../src/services/actionItemsService';

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

let mongoServer: MongoMemoryServer;

const PROJECT_ID = new mongoose.Types.ObjectId();
const CRAWL_JOB_ID = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  // ── Shared fixture: completed crawl job ──────────────────────────────────
  await CrawlJob.create({
    _id: CRAWL_JOB_ID,
    projectId: PROJECT_ID,
    status: 'completed',
    type: 'crawl',
    pageCount: 2,
    completedAt: new Date(),
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

// Clean all AuditIssues and PendingChanges between tests so they don't bleed
afterEach(async () => {
  await AuditIssue.deleteMany({});
  await PendingChange.deleteMany({});
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Field mapping: AuditIssue fields map to ActionItem fields correctly
// ─────────────────────────────────────────────────────────────────────────────

describe('getActionItems — field mapping', () => {
  it('maps whyItMatters → impactOnRanking when whyItMatters is present', async () => {
    const issue = await AuditIssue.create({
      crawlJobId: CRAWL_JOB_ID,
      severity: 'critical',
      category: 'redirect',
      url: 'https://example.com/page-a',
      description: 'Redirect chain of 3 hops detected',
      recommendation: 'Replace with a single 301 redirect to the final destination',
      whyItMatters: 'Redirect chains dilute link equity and add latency, lowering crawl efficiency and rankings.',
    });

    const items = await getActionItems(PROJECT_ID.toString());
    expect(items).toHaveLength(1);

    const item = items[0];
    expect(item.contentId).toBe(issue._id.toString());
    expect(item.pageUrl).toBe('https://example.com/page-a');
    expect(item.impactOnRanking).toBe(
      'Redirect chains dilute link equity and add latency, lowering crawl efficiency and rankings.'
    );
    expect(item.identifiedIssues).toBe('redirect — Redirect chain of 3 hops detected');
    expect(item.howToImprove).toBe(
      'Replace with a single 301 redirect to the final destination'
    );
    expect(item.status).toBe('open'); // no PendingChange exists yet
  });

  it('falls back to category label for impactOnRanking when whyItMatters is absent', async () => {
    await AuditIssue.create({
      crawlJobId: CRAWL_JOB_ID,
      severity: 'warning',
      category: 'meta',
      url: 'https://example.com/page-b',
      description: 'Meta description missing',
      recommendation: 'Add a meta description of 120–158 characters',
      // whyItMatters intentionally omitted
    });

    const items = await getActionItems(PROJECT_ID.toString());
    expect(items).toHaveLength(1);
    expect(items[0].impactOnRanking).toBe('Affects meta signals');
  });

  it('falls back to category label when whyItMatters is an empty string', async () => {
    await AuditIssue.create({
      crawlJobId: CRAWL_JOB_ID,
      severity: 'warning',
      category: 'headings',
      url: 'https://example.com/page-c',
      description: 'Multiple H1 tags detected',
      recommendation: 'Keep exactly one H1 per page',
      whyItMatters: '   ', // whitespace-only — should also fall back
    });

    const items = await getActionItems(PROJECT_ID.toString());
    expect(items).toHaveLength(1);
    expect(items[0].impactOnRanking).toBe('Affects headings signals');
  });

  it('identifiedIssues combines category and description with em-dash separator', async () => {
    await AuditIssue.create({
      crawlJobId: CRAWL_JOB_ID,
      severity: 'passed',
      category: 'canonical',
      url: 'https://example.com/',
      description: 'Canonical URL is self-referential',
      recommendation: 'No action needed',
      whyItMatters: 'Self-referential canonicals signal to Google that this is the primary URL.',
    });

    const items = await getActionItems(PROJECT_ID.toString());
    expect(items[0].identifiedIssues).toBe('canonical — Canonical URL is self-referential');
  });

  it('howToImprove maps directly to recommendation without modification', async () => {
    const recommendation = 'Compress images using WebP and serve via a CDN with long-lived cache headers.';
    await AuditIssue.create({
      crawlJobId: CRAWL_JOB_ID,
      severity: 'warning',
      category: 'performance',
      url: 'https://example.com/product',
      description: 'Page weight exceeds 3MB',
      recommendation,
      whyItMatters: 'Heavy pages load slowly, increasing bounce rates and hurting Core Web Vitals.',
    });

    const items = await getActionItems(PROJECT_ID.toString());
    expect(items[0].howToImprove).toBe(recommendation);
  });

  it('contentId is the string form of the AuditIssue _id', async () => {
    const issue = await AuditIssue.create({
      crawlJobId: CRAWL_JOB_ID,
      severity: 'critical',
      category: 'schema',
      url: 'https://example.com/',
      description: 'No JSON-LD structured data',
      recommendation: 'Add Organization schema to the homepage',
    });

    const items = await getActionItems(PROJECT_ID.toString());
    expect(items[0].contentId).toBe(issue._id.toString());
  });

  it('returns one ActionItem per AuditIssue, not one per URL', async () => {
    // Two issues on the same URL — both should produce separate ActionItems
    await AuditIssue.create([
      {
        crawlJobId: CRAWL_JOB_ID,
        severity: 'critical',
        category: 'redirect',
        url: 'https://example.com/shared',
        description: 'Issue A',
        recommendation: 'Fix A',
      },
      {
        crawlJobId: CRAWL_JOB_ID,
        severity: 'warning',
        category: 'meta',
        url: 'https://example.com/shared',
        description: 'Issue B',
        recommendation: 'Fix B',
      },
    ]);

    const items = await getActionItems(PROJECT_ID.toString());
    expect(items).toHaveLength(2);
    const urls = items.map(i => i.pageUrl);
    expect(urls).toEqual(['https://example.com/shared', 'https://example.com/shared']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Status resolution via PendingChange
// ─────────────────────────────────────────────────────────────────────────────

describe('getActionItems — status from PendingChange', () => {
  it('status is "open" when no PendingChange exists for the AuditIssue', async () => {
    await AuditIssue.create({
      crawlJobId: CRAWL_JOB_ID,
      severity: 'warning',
      category: 'images',
      url: 'https://example.com/gallery',
      description: '5 images missing alt text',
      recommendation: 'Add descriptive alt attributes to all images',
    });

    const items = await getActionItems(PROJECT_ID.toString());
    expect(items[0].status).toBe('open');
  });

  it('status is "approved" when AuditIssue has an associated PendingChange in approved status', async () => {
    const issue = await AuditIssue.create({
      crawlJobId: CRAWL_JOB_ID,
      severity: 'critical',
      category: 'redirect',
      url: 'https://example.com/old-page',
      description: 'Redirect chain of 4 hops',
      recommendation: 'Implement a single 301 to the final URL',
      whyItMatters: 'Each redirect hop adds latency and wastes crawl budget.',
    });

    // Create the linked PendingChange in 'approved' status
    await PendingChange.create({
      sourceAuditIssueId: issue._id,
      projectId: PROJECT_ID,
      status: 'approved',
      proposedChange: 'Updated .htaccess to redirect /old-page directly to /new-page',
    });

    const items = await getActionItems(PROJECT_ID.toString());
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('approved');
    // Ensure all other fields still map correctly even with a PendingChange present
    expect(items[0].impactOnRanking).toBe('Each redirect hop adds latency and wastes crawl budget.');
    expect(items[0].howToImprove).toBe('Implement a single 301 to the final URL');
  });

  it('status is "proposed" when PendingChange status is proposed', async () => {
    const issue = await AuditIssue.create({
      crawlJobId: CRAWL_JOB_ID,
      severity: 'warning',
      category: 'meta',
      url: 'https://example.com/about',
      description: 'Meta description too short (48 chars)',
      recommendation: 'Expand to 120–158 characters',
    });

    await PendingChange.create({
      sourceAuditIssueId: issue._id,
      projectId: PROJECT_ID,
      status: 'proposed',
      proposedChange: 'Draft meta description: "We are a leading provider of..."',
    });

    const items = await getActionItems(PROJECT_ID.toString());
    expect(items[0].status).toBe('proposed');
  });

  it('status is "applied" when PendingChange status is applied', async () => {
    const issue = await AuditIssue.create({
      crawlJobId: CRAWL_JOB_ID,
      severity: 'critical',
      category: 'schema',
      url: 'https://example.com/',
      description: 'Missing Article schema on homepage',
      recommendation: 'Add JSON-LD Article schema',
    });

    await PendingChange.create({
      sourceAuditIssueId: issue._id,
      projectId: PROJECT_ID,
      status: 'applied',
      proposedChange: 'Added <script type="application/ld+json"> to homepage',
      appliedAt: new Date(),
    });

    const items = await getActionItems(PROJECT_ID.toString());
    expect(items[0].status).toBe('applied');
  });

  it('correctly mixes open and non-open statuses when multiple issues exist', async () => {
    // Issue A: has an approved PendingChange
    const issueA = await AuditIssue.create({
      crawlJobId: CRAWL_JOB_ID,
      severity: 'critical',
      category: 'redirect',
      url: 'https://example.com/a',
      description: 'Redirect chain',
      recommendation: 'Fix redirect chain',
    });

    // Issue B: no PendingChange (open)
    await AuditIssue.create({
      crawlJobId: CRAWL_JOB_ID,
      severity: 'warning',
      category: 'meta',
      url: 'https://example.com/b',
      description: 'Short meta description',
      recommendation: 'Expand meta description',
    });

    // Issue C: applied PendingChange
    const issueC = await AuditIssue.create({
      crawlJobId: CRAWL_JOB_ID,
      severity: 'passed',
      category: 'canonical',
      url: 'https://example.com/c',
      description: 'Canonical is correct',
      recommendation: 'No action needed',
    });

    await PendingChange.create([
      {
        sourceAuditIssueId: issueA._id,
        projectId: PROJECT_ID,
        status: 'approved',
        proposedChange: 'Shorten redirect',
      },
      {
        sourceAuditIssueId: issueC._id,
        projectId: PROJECT_ID,
        status: 'applied',
        proposedChange: 'Already correct',
        appliedAt: new Date(),
      },
    ]);

    const items = await getActionItems(PROJECT_ID.toString());
    expect(items).toHaveLength(3);

    const byUrl = Object.fromEntries(items.map(i => [i.pageUrl, i.status]));
    expect(byUrl['https://example.com/a']).toBe('approved');
    expect(byUrl['https://example.com/b']).toBe('open');
    expect(byUrl['https://example.com/c']).toBe('applied');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Error cases
// ─────────────────────────────────────────────────────────────────────────────

describe('getActionItems — error handling', () => {
  it('throws NoCompletedCrawlError for a project that has never been audited', async () => {
    const unknownId = new mongoose.Types.ObjectId().toString();
    await expect(getActionItems(unknownId)).rejects.toThrow(NoCompletedCrawlError);
  });

  it('NoCompletedCrawlError message names the project and mentions audit', async () => {
    const unknownId = new mongoose.Types.ObjectId().toString();
    try {
      await getActionItems(unknownId);
      fail('Expected NoCompletedCrawlError');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(NoCompletedCrawlError);
      const error = err as NoCompletedCrawlError;
      expect(error.message).toContain(unknownId);
      expect(error.message.toLowerCase()).toContain('audit');
    }
  });

  it('returns an empty array (not an error) when the crawl succeeded but produced zero AuditIssues', async () => {
    // Create a fresh project/job with no AuditIssues
    const emptyProjectId = new mongoose.Types.ObjectId();
    await CrawlJob.create({
      projectId: emptyProjectId,
      status: 'completed',
      type: 'crawl',
      pageCount: 1,
      completedAt: new Date(),
    });

    const items = await getActionItems(emptyProjectId.toString());
    expect(items).toEqual([]);
  });

  it('does not use migration-check jobs to satisfy the completed-crawl requirement', async () => {
    const migrationOnlyId = new mongoose.Types.ObjectId();
    await CrawlJob.create({
      projectId: migrationOnlyId,
      status: 'completed',
      type: 'migration-check',
      pageCount: 5,
      completedAt: new Date(),
    });

    await expect(getActionItems(migrationOnlyId.toString())).rejects.toThrow(
      NoCompletedCrawlError
    );
  });
});

describe('getActionItems — Content-Type Action Items (Phase 2)', () => {
  it('Test 1: given a mock scanned PDF PageContent record, asserts an ActionItem is generated with high-impact framing', async () => {
    const projId = new mongoose.Types.ObjectId();
    const crawlJob = await CrawlJob.create({
      projectId: projId,
      status: 'completed',
      type: 'crawl',
      pageCount: 1,
      completedAt: new Date(),
    });

    await PageContent.create({
      projectId: projId,
      crawlJobId: crawlJob._id,
      pageUrl: 'https://example.com/scanned-report.pdf',
      contentType: 'pdf',
      sourceUrl: 'https://example.com/scanned-report.pdf',
      isScannedOnly: true,
      extractedText: '',
      extractionStatus: 'success',
    });

    const items = await getActionItems(projId.toString());

    expect(items.length).toBe(1);
    const pdfItem = items[0];
    expect(pdfItem.identifiedIssues).toContain('pdf-accessibility');
    expect(pdfItem.impactOnRanking).toContain('Search engines cannot index scanned image-only PDFs');
    expect(pdfItem.howToImprove).toContain('Optical Character Recognition (OCR)');
    expect(pdfItem.status).toBe('open');
  });

  it('Test 2: given a mock video with no transcript, asserts the corresponding ActionItem is generated', async () => {
    const projId = new mongoose.Types.ObjectId();
    const crawlJob = await CrawlJob.create({
      projectId: projId,
      status: 'completed',
      type: 'crawl',
      pageCount: 1,
      completedAt: new Date(),
    });

    await PageContent.create({
      projectId: projId,
      crawlJobId: crawlJob._id,
      pageUrl: 'https://example.com/video-demo',
      contentType: 'video',
      sourceUrl: 'https://example.com/video-demo.mp4',
      hasTranscript: false,
      extractionStatus: 'success',
    });

    const items = await getActionItems(projId.toString());

    expect(items.length).toBe(1);
    const videoItem = items[0];
    expect(videoItem.identifiedIssues).toContain('video-transcript');
    expect(videoItem.impactOnRanking).toContain('Search engines cannot process audio streams without written transcripts');
    expect(videoItem.howToImprove).toContain('WebVTT closed captions');
    expect(videoItem.status).toBe('open');
  });

  it('Test 3: given a normal page with no content-type issues, asserts no spurious content-type action items are generated', async () => {
    const projId = new mongoose.Types.ObjectId();
    const crawlJob = await CrawlJob.create({
      projectId: projId,
      status: 'completed',
      type: 'crawl',
      pageCount: 1,
      completedAt: new Date(),
    });

    // Clean page: image has altText, video has transcript, text is normal
    await PageContent.create([
      {
        projectId: projId,
        crawlJobId: crawlJob._id,
        pageUrl: 'https://example.com/clean-page',
        contentType: 'text',
        sourceUrl: 'https://example.com/clean-page',
        extractionStatus: 'success',
      },
      {
        projectId: projId,
        crawlJobId: crawlJob._id,
        pageUrl: 'https://example.com/clean-page',
        contentType: 'image',
        sourceUrl: 'https://example.com/clean-logo.png',
        altText: 'Clean Company Logo',
        extractionStatus: 'success',
      },
      {
        projectId: projId,
        crawlJobId: crawlJob._id,
        pageUrl: 'https://example.com/clean-page',
        contentType: 'video',
        sourceUrl: 'https://example.com/clean-video.mp4',
        hasTranscript: true,
        extractedText: 'Subtitles text content',
        extractionStatus: 'success',
      },
    ]);

    const items = await getActionItems(projId.toString());
    expect(items).toEqual([]);
  });
});
