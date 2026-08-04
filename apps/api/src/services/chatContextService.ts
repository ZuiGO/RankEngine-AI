import mongoose from 'mongoose';
import { CrawlJob } from '../models/CrawlJob';
import { AuditIssue } from '../models/AuditIssue';
import { TrackedKeyword } from '../models/TrackedKeyword';
import { RankSnapshot } from '../models/RankSnapshot';
import { TrackedPrompt } from '../models/TrackedPrompt';
import { AiVisibilitySnapshot } from '../models/AiVisibilitySnapshot';

export async function buildOverviewContext(projectId: string): Promise<string> {
  const projectObjectId = new mongoose.Types.ObjectId(projectId);
  const now = new Date();

  const latestCrawl = await CrawlJob.findOne({
    projectId: projectObjectId,
    status: 'completed',
  })
    .sort({ completedAt: -1 })
    .select('healthScore completedAt')
    .lean();

  if (!latestCrawl) {
    return 'No audit data available yet for this project.';
  }

  const parts: string[] = [];

  const healthScore = latestCrawl.healthScore;
  if (healthScore != null) {
    parts.push(`Health Score: ${healthScore}/100`);
  }

  const criticalIssues = await AuditIssue.find({
    crawlJobId: latestCrawl._id,
    severity: 'critical',
  })
    .select('description')
    .limit(3)
    .lean();

  if (criticalIssues.length > 0) {
    const issueList = criticalIssues.map((i, idx) => `${idx + 1}. ${i.description}`).join('\n');
    parts.push(`Top Critical Issues:\n${issueList}`);
  }

  const trackedKeywords = await TrackedKeyword.find({ projectId: projectObjectId })
    .select('_id keyword')
    .lean();

  if (trackedKeywords.length > 0) {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const rankLines: string[] = [];

    for (const kw of trackedKeywords) {
      const currentSnap = await RankSnapshot.findOne({ keywordId: kw._id })
        .sort({ date: -1 })
        .select('position date')
        .lean();

      if (!currentSnap) continue;

      const oldSnap = await RankSnapshot.findOne({
        keywordId: kw._id,
        date: { $lte: thirtyDaysAgo },
      })
        .sort({ date: -1 })
        .select('position')
        .lean();

      const currentPos = currentSnap.position;
      let trend = 'flat';
      if (oldSnap) {
        if (oldSnap.position > currentPos) trend = 'up';
        else if (oldSnap.position < currentPos) trend = 'down';
      }
      rankLines.push(`${kw.keyword}: pos ${currentPos} (${trend})`);
    }

    if (rankLines.length > 0) {
      parts.push(`Rank Tracking:\n${rankLines.join('\n')}`);
    }
  }

  const trackedPrompts = await TrackedPrompt.find({ projectId: projectObjectId })
    .select('_id')
    .lean();

  if (trackedPrompts.length > 0) {
    const engines = ['chatgpt', 'gemini', 'perplexity', 'google_aio'] as const;
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const computeScore = async (dateThreshold: Date): Promise<number> => {
      let totalChecks = 0;
      let totalMentions = 0;
      for (const prompt of trackedPrompts) {
        for (const engine of engines) {
          const snap = await AiVisibilitySnapshot.findOne({
            trackedPromptId: prompt._id,
            engine,
            checkedAt: { $lte: dateThreshold },
          })
            .sort({ checkedAt: -1 })
            .select('mentioned')
            .lean();
          if (snap) {
            totalChecks++;
            if (snap.mentioned) totalMentions++;
          }
        }
      }
      return totalChecks > 0 ? Math.round((totalMentions / totalChecks) * 100) : 0;
    };

    const currentScore = await computeScore(now);
    const oldScore = await computeScore(thirtyDaysAgo);

    parts.push(`AI Visibility: ${currentScore}% (was ${oldScore}% 30 days ago)`);
  }

  return parts.join('\n\n');
}

export async function buildActionItemsContext(projectId: string): Promise<string> {
  const projectObjectId = new mongoose.Types.ObjectId(projectId);
  const latestCrawl = await CrawlJob.findOne({ projectId: projectObjectId, status: 'completed' })
    .sort({ completedAt: -1 })
    .select('_id')
    .lean();

  if (!latestCrawl) {
    return 'Action Items Context: No crawl data available yet for this project.';
  }

  const issues = await AuditIssue.find({ crawlJobId: latestCrawl._id })
    .select('url category description recommendation whyItMatters severity')
    .limit(10)
    .lean();

  if (issues.length === 0) {
    return 'Action Items Context: No open action items found for this project.';
  }

  const lines = issues.map((item, idx) => {
    const actionText = item.recommendation || item.description;
    return `${idx + 1}. [${(item.severity || 'warning').toUpperCase()}] Page: ${item.url} - ${actionText}${item.whyItMatters ? ` (Why: ${item.whyItMatters})` : ''}`;
  });

  return `Current Open Action Items List:\n${lines.join('\n')}`;
}

export async function buildProjectContext(
  projectId: string,
  section?: string,
  _question?: string
): Promise<string> {
  const normSection = (section || 'Overview').toLowerCase().replace(/[\s_]+/g, '');

  if (normSection === 'actionitems' || normSection === 'actionitem') {
    return buildActionItemsContext(projectId);
  }

  return buildOverviewContext(projectId);
}

