import mongoose from 'mongoose';
import { CrawlJob } from '../models/CrawlJob';
import { AuditIssue } from '../models/AuditIssue';
import { PageContent, IPageContent } from '../models/PageContent';
import { PendingChange } from '../models/PendingChange';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type ActionItemStatus = 'open' | 'proposed' | 'approved' | 'applied';

export interface ActionItem {
  /**
   * Stable identifier for this action item.
   * Maps to the AuditIssue or PageContent MongoDB _id (as a string).
   */
  contentId: string;

  /** The page URL the audit issue was found on. */
  pageUrl: string;

  /**
   * Why this issue matters for rankings.
   */
  impactOnRanking: string;

  /**
   * A description of the problem found.
   * Format: "[category] — description"
   */
  identifiedIssues: string;

  /**
   * Concrete steps to fix the issue.
   */
  howToImprove: string;

  /**
   * Write-back lifecycle status.
   */
  status: ActionItemStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error type
// ─────────────────────────────────────────────────────────────────────────────

export class NoCompletedCrawlError extends Error {
  constructor(projectId: string) {
    super(
      `No completed crawl job found for project ${projectId}. ` +
      'Run an audit first before generating action items.'
    );
    this.name = 'NoCompletedCrawlError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Field mapping helpers
// ─────────────────────────────────────────────────────────────────────────────

function deriveImpactOnRanking(issue: { whyItMatters?: string; category: string }): string {
  const val = (issue.whyItMatters ?? '').trim();
  return val.length > 0 ? val : `Affects ${issue.category} signals`;
}

function deriveIdentifiedIssues(issue: { category: string; description: string }): string {
  const cat = issue.category.trim();
  const desc = issue.description.trim();
  if (!cat) return desc;
  if (!desc) return cat;
  return `${cat} — ${desc}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns action items for `projectId` by combining AuditIssue data and PageContent
 * extraction records into the ActionItem interface columns.
 */
export async function getActionItems(projectId: string): Promise<ActionItem[]> {
  // ── 1. Resolve the latest completed standard crawl job ────────────────────
  const crawlJob = await CrawlJob.findOne({
    projectId: new mongoose.Types.ObjectId(projectId),
    status: 'completed',
    type: { $ne: 'migration-check' },
  })
    .sort({ completedAt: -1 })
    .lean();

  if (!crawlJob) {
    throw new NoCompletedCrawlError(projectId);
  }

  // ── 2. Fetch AuditIssues & PageContent records for this crawl job ──────────
  const issues = await AuditIssue.find({ crawlJobId: crawlJob._id })
    .select('_id url severity category description recommendation whyItMatters')
    .lean();

  const pageContents = await PageContent.find({ crawlJobId: crawlJob._id }).lean();

  // If no audit issues and no page contents exist, return empty array
  if (issues.length === 0 && pageContents.length === 0) {
    return [];
  }

  // Synthesize content-type action items from PageContent records
  const contentActionItemsRaw: {
    contentId: string;
    pageUrl: string;
    impactOnRanking: string;
    identifiedIssues: string;
    howToImprove: string;
    category: string;
  }[] = [];

  for (const pc of pageContents) {
    const pcId = pc._id.toString();
    const pcPageUrl = pc.pageUrl || pc.sourceUrl;

    // Case 1: Scanned / no-text-layer PDF
    if (pc.contentType === 'pdf' && ((pc as any).isScannedOnly === true || (pc.extractedText && pc.extractedText.trim().length < 20 && pc.extractedText.trim().length >= 0))) {
      contentActionItemsRaw.push({
        contentId: pcId,
        pageUrl: pcPageUrl,
        impactOnRanking: 'Search engines cannot index scanned image-only PDFs without text layers. This content is invisible to search engine crawlers and screen readers.',
        identifiedIssues: 'pdf-accessibility — Scanned PDF with no extractable text layer.',
        howToImprove: 'Run Optical Character Recognition (OCR) on the PDF or provide an equivalent HTML text page.',
        category: 'pdf-accessibility',
      });
    }

    // Case 2: Video with no transcript
    else if (pc.contentType === 'video' && pc.hasTranscript === false) {
      contentActionItemsRaw.push({
        contentId: pcId,
        pageUrl: pcPageUrl,
        impactOnRanking: 'Search engines cannot process audio streams without written transcripts, harming video SEO and accessibility.',
        identifiedIssues: 'video-transcript — Video present on page with no caption or transcript track.',
        howToImprove: 'Add WebVTT closed captions or an inline text transcript for the video.',
        category: 'video-transcript',
      });
    }

    // Case 3: Missing alt text on images
    else if (pc.contentType === 'image' && (pc.altText === undefined || pc.altText === null || pc.altText.trim() === '')) {
      contentActionItemsRaw.push({
        contentId: pcId,
        pageUrl: pcPageUrl,
        impactOnRanking: 'Alt text is required for Google Image search indexing and Web Content Accessibility Guidelines (WCAG).',
        identifiedIssues: 'image-alt — Image missing descriptive alt text attribute.',
        howToImprove: 'Add a descriptive alt text attribute to the image.',
        category: 'image-alt',
      });
    }

    // Case 4: Linked XLSX / DOCX / PPTX document without on-page summary
    else if (['xlsx', 'docx', 'pptx'].includes(pc.contentType) && ((pc as any).isUnsummarized === true || ((pc as any).extractedText && (pc as any).extractedText.length > 50))) {
      contentActionItemsRaw.push({
        contentId: pcId,
        pageUrl: pcPageUrl,
        impactOnRanking: 'Search engines index HTML page text, not linked binary files. Pages linking documents without on-page context are under-optimized.',
        identifiedIssues: `document-unsummarized — Linked ${pc.contentType.toUpperCase()} document not accompanied by on-page summary.`,
        howToImprove: 'Add an on-page text summary or key takeaways above the document download link.',
        category: 'document-unsummarized',
      });
    }

    // Case 5: PDF with valuable text NOT reflected on HTML page
    else if (pc.contentType === 'pdf' && (pc as any).isUnreflected === true) {
      contentActionItemsRaw.push({
        contentId: pcId,
        pageUrl: pcPageUrl,
        impactOnRanking: 'Search engines give primary ranking weight to HTML page content over downloadable attachments.',
        identifiedIssues: 'pdf-unreflected-text — PDF contains valuable text not reflected on the HTML page.',
        howToImprove: 'Surface key findings and headings from the PDF directly into the main HTML page text.',
        category: 'pdf-unreflected-text',
      });
    }
  }

  // ── 3. Resolve PendingChange statuses for all item IDs in a single query ────
  const issueIds = issues.map((i) => i._id);
  const pcIds = contentActionItemsRaw.map((item) => new mongoose.Types.ObjectId(item.contentId));
  const allTargetIds = [...issueIds, ...pcIds];

  const pendingChanges = await PendingChange.find({
    sourceAuditIssueId: { $in: allTargetIds },
  })
    .select('sourceAuditIssueId status')
    .lean();

  const statusByIssueId = new Map<string, 'proposed' | 'approved' | 'applied'>();
  for (const pc of pendingChanges) {
    statusByIssueId.set(pc.sourceAuditIssueId.toString(), pc.status);
  }

  // ── 4. Reshape AuditIssues into ActionItems ───────────────────────────────
  const actionItems: ActionItem[] = issues.map((issue) => {
    const issueIdStr = issue._id.toString();
    const pendingStatus = statusByIssueId.get(issueIdStr);

    return {
      contentId: issueIdStr,
      pageUrl: issue.url,
      impactOnRanking: deriveImpactOnRanking(issue),
      identifiedIssues: deriveIdentifiedIssues(issue),
      howToImprove: issue.recommendation,
      status: pendingStatus ?? 'open',
    };
  });

  // Track existing categories per page to avoid duplicate items between AuditIssue and PageContent
  const existingKeys = new Set(issues.map((i) => `${i.url}::${i.category}`));

  for (const raw of contentActionItemsRaw) {
    const key = `${raw.pageUrl}::${raw.category}`;
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      const pendingStatus = statusByIssueId.get(raw.contentId);
      actionItems.push({
        contentId: raw.contentId,
        pageUrl: raw.pageUrl,
        impactOnRanking: raw.impactOnRanking,
        identifiedIssues: raw.identifiedIssues,
        howToImprove: raw.howToImprove,
        status: pendingStatus ?? 'open',
      });
    }
  }

  return actionItems;
}

