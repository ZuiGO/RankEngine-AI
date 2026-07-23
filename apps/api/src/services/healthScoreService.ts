import { AuditIssue } from '../models/AuditIssue';
import { CrawlJob } from '../models/CrawlJob';
import mongoose from 'mongoose';

/**
 * Expected Category Weights:
 * - Crawlability: 20%
 * - Indexability: 15%
 * - Performance: 15%
 * - On-Page SEO: 15%
 * - Content: 10%
 * - Core Web Vitals: 10%
 * - Structured Data: 5%
 * - Accessibility: 5%
 * - Security: 3%
 * - Social & HTML: 2%
 */
const CATEGORY_WEIGHTS: Record<string, number> = {
  crawlability: 0.20,
  indexing: 0.15,
  performance: 0.15,
  'on-page': 0.15,
  meta: 0.15, // fallback alias for on-page
  content: 0.10,
  'core-web-vitals': 0.10,
  schema: 0.05,
  accessibility: 0.05,
  security: 0.03,
  social: 0.02,
  html: 0.02,
  url: 0.02,
  analytics: 0.02,
};

export interface IssueLike {
  category: string;
  severity: 'critical' | 'warning' | 'info' | 'passed';
}

/**
 * Compute weighted SEO Health Score (0-100) based on issue categories.
 */
export const computeWeightedHealthScore = (issues: IssueLike[]): number => {
  const issuesByCategory: Record<string, { critical: number; warning: number }> = {};

  for (const issue of issues) {
    if (issue.severity === 'info' || issue.severity === 'passed') continue;
    const cat = (issue.category || 'meta').toLowerCase();
    if (!issuesByCategory[cat]) {
      issuesByCategory[cat] = { critical: 0, warning: 0 };
    }
    if (issue.severity === 'critical') {
      issuesByCategory[cat].critical += 1;
    } else if (issue.severity === 'warning') {
      issuesByCategory[cat].warning += 1;
    }
  }

  let totalWeightedScore = 0;
  let totalWeightApplied = 0;

  for (const [cat, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    const counts = issuesByCategory[cat] || { critical: 0, warning: 0 };
    const categoryScore = Math.max(0, 100 - counts.critical * 15 - counts.warning * 5);
    totalWeightedScore += categoryScore * weight;
    totalWeightApplied += weight;
  }

  // Normalize in case weights sum slightly over 1.0 due to category aliases
  const rawScore = totalWeightApplied > 0 ? totalWeightedScore / totalWeightApplied : 100;
  return Math.round(Math.max(0, Math.min(100, rawScore)));
};

/**
 * Fallback for backwards compatibility with simple count signature
 */
export const computeHealthScore = (criticalCount: number, warningCount: number): number => {
  const raw = 100 - criticalCount * 15 - warningCount * 5;
  return Math.max(0, Math.min(100, raw));
};

/**
 * Compute and persist the health score for a completed crawl job,
 * then return the score and the previous score for trend display.
 */
export const computeAndStoreHealthScore = async (
  crawlJobId: string
): Promise<{ healthScore: number; previousHealthScore: number | null }> => {
  const issues = await AuditIssue.find({
    crawlJobId: new mongoose.Types.ObjectId(crawlJobId),
  });

  const healthScore = computeWeightedHealthScore(
    issues.map((i) => ({ category: i.category, severity: i.severity as any }))
  );

  const currentJob = await CrawlJob.findByIdAndUpdate(crawlJobId, { healthScore }, { new: true });

  let previousHealthScore: number | null = null;

  if (currentJob) {
    const previousJob = await CrawlJob.findOne({
      projectId: currentJob.projectId,
      _id: { $ne: currentJob._id },
      status: 'completed',
      healthScore: { $exists: true },
    }).sort({ completedAt: -1 });

    if (previousJob && previousJob.healthScore != null) {
      previousHealthScore = previousJob.healthScore;
    }
  }

  return { healthScore, previousHealthScore };
};

