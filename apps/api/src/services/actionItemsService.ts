import mongoose from 'mongoose';
import { CrawlJob } from '../models/CrawlJob';
import { AuditIssue } from '../models/AuditIssue';
import { PendingChange } from '../models/PendingChange';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type ActionItemStatus = 'open' | 'proposed' | 'approved' | 'applied';

export interface ActionItem {
  /**
   * Stable identifier for this action item.
   * Maps to the AuditIssue's own MongoDB _id (as a string).
   */
  contentId: string;

  /** The page URL the audit issue was found on. */
  pageUrl: string;

  /**
   * Why this issue matters for rankings.
   * Maps to AuditIssue.whyItMatters.
   * Falls back to the category label when whyItMatters was not populated
   * by the LLM (older crawl jobs may lack it).
   */
  impactOnRanking: string;

  /**
   * A description of the problem found.
   * Combines AuditIssue.category and AuditIssue.description so the consumer
   * has both the classification and the plain-English explanation in one field.
   * Format: "[category] — description"
   */
  identifiedIssues: string;

  /**
   * Concrete steps to fix the issue.
   * Maps directly to AuditIssue.recommendation.
   */
  howToImprove: string;

  /**
   * Write-back lifecycle status.
   *
   * - 'open':     No PendingChange document exists for this AuditIssue.
   * - 'proposed': A fix has been drafted but not reviewed.
   * - 'approved': The fix has been accepted, ready to apply.
   * - 'applied':  The fix has been deployed.
   *
   * The actual status is read from PendingChange.status when a matching
   * PendingChange (keyed by sourceAuditIssueId) exists; 'open' is implicit.
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

/**
 * Maps an AuditIssue's whyItMatters to impactOnRanking.
 * Falls back to the category label when whyItMatters is absent — this happens
 * for older crawl jobs where the LLM did not populate the field.
 */
function deriveImpactOnRanking(issue: { whyItMatters?: string; category: string }): string {
  const val = (issue.whyItMatters ?? '').trim();
  return val.length > 0 ? val : `Affects ${issue.category} signals`;
}

/**
 * Maps an AuditIssue's category + description to identifiedIssues.
 * Combines both so the consumer has the classification and the plain-English
 * explanation in one field.
 */
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
 * Returns action items for `projectId` by reshaping existing AuditIssue data
 * into the ActionItem interface columns. The `status` field is resolved by
 * looking up any PendingChange documents keyed on sourceAuditIssueId.
 *
 * No LLM calls are made. This is a pure read + reshape over data the audit
 * engine already produced.
 *
 * Throws `NoCompletedCrawlError` when the project has never been audited.
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

  // ── 2. Fetch all AuditIssues for this crawl job ───────────────────────────
  const issues = await AuditIssue.find({ crawlJobId: crawlJob._id })
    .select('_id url severity category description recommendation whyItMatters')
    .lean();

  if (issues.length === 0) {
    return [];
  }

  // ── 3. Resolve PendingChange statuses for all issues in a single query ────
  const issueIds = issues.map((i) => i._id);

  const pendingChanges = await PendingChange.find({
    sourceAuditIssueId: { $in: issueIds },
  })
    .select('sourceAuditIssueId status')
    .lean();

  // Build a lookup map: auditIssueId (string) → PendingChangeStatus
  const statusByIssueId = new Map<string, 'proposed' | 'approved' | 'applied'>();
  for (const pc of pendingChanges) {
    statusByIssueId.set(pc.sourceAuditIssueId.toString(), pc.status);
  }

  // ── 4. Reshape into ActionItems ───────────────────────────────────────────
  const actionItems: ActionItem[] = issues.map((issue) => {
    const issueIdStr = issue._id.toString();
    const pendingStatus = statusByIssueId.get(issueIdStr);

    return {
      contentId: issueIdStr,
      pageUrl: issue.url,
      impactOnRanking: deriveImpactOnRanking(issue),
      identifiedIssues: deriveIdentifiedIssues(issue),
      howToImprove: issue.recommendation,
      // 'open' is implicit — no PendingChange document exists for this issue
      status: pendingStatus ?? 'open',
    };
  });

  return actionItems;
}
