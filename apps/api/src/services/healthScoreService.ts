import { AuditIssue } from '../models/AuditIssue';
import { CrawlJob } from '../models/CrawlJob';
import mongoose from 'mongoose';

/**
 * SEO Health Score formula (0-100):
 *
 *   score = 100 - (criticalCount * 15) - (warningCount * 5)
 *
 * - Each critical issue deducts 15 points (heavy weight).
 * - Each warning deducts 5 points (lighter weight).
 * - Passed checks don't add points directly; they simply avoid deductions.
 * - The score is clamped to [0, 100].
 *
 * This is deliberately simple and transparent so non-technical users
 * understand why the number moves. A single critical issue (missing H1,
 * broken redirect) drops the score to 85, while 5 warnings drop it to 75.
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

  const criticalCount = issues.filter((i) => i.severity === 'critical').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const healthScore = computeHealthScore(criticalCount, warningCount);

  await CrawlJob.findByIdAndUpdate(crawlJobId, { healthScore });

  // Find the previous completed crawl for the same project to get trend
  const currentJob = await CrawlJob.findById(crawlJobId);
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
