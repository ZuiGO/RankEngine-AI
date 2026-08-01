import mongoose from 'mongoose';
import { CrawlJob } from '../models/CrawlJob';
import { AuditIssue } from '../models/AuditIssue';
import { BacklinkSnapshot } from '../models/BacklinkSnapshot';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface SiteReportIssue {
  severity: 'critical' | 'warning' | 'passed';
  category: string;
  description: string;
}

export interface SiteReportPage {
  url: string;
  issues: SiteReportIssue[];
}

export interface SiteReportCounts {
  /**
   * Number of HTML pages the crawler visited during the most recent completed
   * audit. Source: CrawlJob.pageCount (set by the worker as pages are crawled).
   */
  pageCount: number;

  /**
   * Sum of all anchor-tag links found across every crawled page
   * (internal + external combined).
   * Source: crawlresults collection — sum of (page.internalLinkCount + page.externalLinkCount).
   *
   * Note: The crawler does not distinguish "hyperlinks" from "links" as two
   * separate concepts — it classifies every <a href> as either internal or
   * external. Therefore totalHyperlinks equals totalLinks.
   */
  totalLinks: number;

  /**
   * Equal to totalLinks for this codebase — see note above.
   * Exposed as a distinct field for API contract completeness.
   */
  totalHyperlinks: number;

  /**
   * Sum of internalLinkCount across all crawled pages.
   * Source: crawlresults collection — sum of page.internalLinkCount.
   */
  internalLinks: number;

  /**
   * Total inbound backlinks from the most recently cached BacklinkSnapshot
   * for the project. Returns 0 when no snapshot has been stored yet
   * (i.e. the backlinks overview endpoint was never called or DataForSEO
   * is not configured).
   * Source: BacklinkSnapshot model.
   */
  backlinkCount: number;

  /**
   * Summary content inventory counters extracted from crawled pages.
   */
  pdfCount?: number;
  videoCount?: number;
  imageCount?: number;
  documentCount?: number;
}

export interface SiteReport {
  projectId: string;
  generatedAt: Date;
  counts: SiteReportCounts;
  pages: SiteReportPage[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Error class for a clearly unaudited project
// ─────────────────────────────────────────────────────────────────────────────

export class NoCompletedCrawlError extends Error {
  constructor(projectId: string) {
    super(
      `No completed crawl job found for project ${projectId}. ` +
      'Run an audit first before generating a site report.'
    );
    this.name = 'NoCompletedCrawlError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CrawlResult page shape (as stored by apps/worker/crawler.py)
// ─────────────────────────────────────────────────────────────────────────────

interface CrawlResultPage {
  url: string;
  internalLinkCount?: number;
  externalLinkCount?: number;
  // outboundLinks is an array of resolved internal URLs (duplicates of internalLinkCount)
  outboundLinks?: string[];
  [key: string]: unknown;
}

interface CrawlResult {
  crawlJobId: mongoose.Types.ObjectId;
  pages: CrawlResultPage[];
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core service function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assembles a consolidated SiteReport for `projectId` from data that already
 * exists in MongoDB after a crawl completes. This is a pure read/aggregate
 * layer — it does not trigger any new crawl, LLM call, or external API request.
 *
 * Throws `NoCompletedCrawlError` if no completed CrawlJob exists, so callers
 * can surface a meaningful error instead of a report full of zeros.
 */
export async function generateSiteReport(projectId: string): Promise<SiteReport> {
  // ── 1. Resolve the latest completed crawl job ─────────────────────────────
  const crawlJob = await CrawlJob.findOne({
    projectId: new mongoose.Types.ObjectId(projectId),
    status: 'completed',
    type: { $ne: 'migration-check' }, // exclude migration-check jobs
  })
    .sort({ completedAt: -1 })
    .lean();

  if (!crawlJob) {
    throw new NoCompletedCrawlError(projectId);
  }

  const crawlJobId = crawlJob._id.toString();

  // ── 2. Fetch audit issues from AuditIssue collection ─────────────────────
  // Fetch all issues for this crawl job in one query (no pagination — this is
  // an internal aggregate, not a user-facing paginated endpoint).
  const rawIssues = await AuditIssue.find({ crawlJobId: crawlJob._id })
    .select('url severity category description')
    .lean();

  // ── 3. Group issues by URL to build the pages array ──────────────────────
  const pageIssueMap = new Map<string, SiteReportIssue[]>();

  for (const issue of rawIssues) {
    const url: string = issue.url || 'N/A';
    if (!pageIssueMap.has(url)) {
      pageIssueMap.set(url, []);
    }
    pageIssueMap.get(url)!.push({
      severity: issue.severity as SiteReportIssue['severity'],
      category: issue.category,
      description: issue.description,
    });
  }

  const pages: SiteReportPage[] = Array.from(pageIssueMap.entries()).map(
    ([url, issues]) => ({ url, issues })
  );

  // ── 4. Fetch crawlresults to compute link counts ──────────────────────────
  // The worker stores raw page data (including internalLinkCount and
  // externalLinkCount per page) in the `crawlresults` MongoDB collection.
  // rawResultsRef on CrawlJob is the stringified ObjectId of that document.
  let totalLinks = 0;
  let internalLinks = 0;
  let pdfCount = 0;
  let videoCount = 0;
  let imageCount = 0;
  let documentCount = 0;

  const db = mongoose.connection.db;

  if (db && crawlJob.rawResultsRef) {
    // rawResultsRef is a stringified ObjectId; guard against invalid format
    if (mongoose.Types.ObjectId.isValid(crawlJob.rawResultsRef)) {
      const crawlResult = await db.collection<CrawlResult>('crawlresults').findOne(
        { _id: new mongoose.Types.ObjectId(crawlJob.rawResultsRef) },
        { projection: { 'pages.internalLinkCount': 1, 'pages.externalLinkCount': 1, 'pages.contentInventory': 1 } }
      );

      if (crawlResult?.pages) {
        for (const page of crawlResult.pages) {
          const il = Number(page.internalLinkCount ?? 0);
          const el = Number(page.externalLinkCount ?? 0);
          internalLinks += il;
          totalLinks += il + el;

          const inv = (page as any).contentInventory;
          if (inv) {
            imageCount += Number(inv.imageCount ?? 0);
            videoCount += Number(inv.videoCount ?? 0);
            documentCount += Number(inv.documentCount ?? 0);
            if (Array.isArray(inv.documents)) {
              for (const doc of inv.documents) {
                if (doc.type === 'pdf') pdfCount++;
              }
            }
          }
        }
      }
    }
  }

  // If rawResultsRef was not set or crawlresults document was not found,
  // fall back to CrawlJob.pageCount as a signal — we can't compute link
  // counts without the raw data, so they remain 0 (explicitly not faked).

  // ── 5. Fetch the most recent backlink snapshot ────────────────────────────
  const backlinkSnapshot = await BacklinkSnapshot.findOne({ projectId })
    .sort({ date: -1 })
    .lean();

  const backlinkCount = backlinkSnapshot?.totalBacklinks ?? 0;

  // ── 6. Assemble and return ────────────────────────────────────────────────
  return {
    projectId,
    generatedAt: new Date(),
    counts: {
      pageCount: crawlJob.pageCount,
      totalLinks,
      // The crawler classifies every <a href> as internal or external —
      // there is no separate "hyperlink" concept vs "link". These are equal.
      totalHyperlinks: totalLinks,
      internalLinks,
      backlinkCount,
      pdfCount,
      videoCount,
      imageCount,
      documentCount,
    },
    pages,
  };
}
