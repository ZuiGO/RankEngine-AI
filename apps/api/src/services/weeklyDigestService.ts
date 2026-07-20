import mongoose from 'mongoose';
import cron from 'node-cron';
import { User } from '../models/User';
import { Project } from '../models/Project';
import { CrawlJob } from '../models/CrawlJob';
import { AuditIssue } from '../models/AuditIssue';
import { TrackedKeyword } from '../models/TrackedKeyword';
import { RankSnapshot } from '../models/RankSnapshot';
import { Notification } from '../models/Notification';
import { getEmailService } from './emailService';

export interface WeeklyDigest {
  auditsRun: number;
  newCriticalIssues: number;
  keywordsUp: number;
  keywordsDown: number;
  competitorAlerts: number;
  projectSummaries: {
    projectName: string;
    auditsRun: number;
    criticalIssues: number;
    keywordsUp: number;
    keywordsDown: number;
    alerts: number;
  }[];
}

const SEVEN_DAYS_AGO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d;
};

export const buildDigestForUser = async (userId: string): Promise<WeeklyDigest | null> => {
  const user = await User.findById(userId);
  if (!user || !user.emailDigestEnabled) return null;

  const projects = await Project.find({ ownerId: userId, deletedAt: null });
  if (projects.length === 0) return null;

  const since = SEVEN_DAYS_AGO();
  const projectIds = projects.map((p) => p._id);

  // 1. Audits run in last 7 days
  const recentCrawlJobs = await CrawlJob.find({
    projectId: { $in: projectIds },
    completedAt: { $gte: since },
    status: 'completed',
  });

  // 2. New critical issues from those audits
  const recentCrawlJobIds = recentCrawlJobs.map((j) => j._id);
  const newCriticalIssues = await AuditIssue.countDocuments({
    crawlJobId: { $in: recentCrawlJobIds },
    severity: 'critical',
  });

  // 3. Ranking movement
  const trackedKeywords = await TrackedKeyword.find({
    projectId: { $in: projectIds },
  });

  let keywordsUp = 0;
  let keywordsDown = 0;

  for (const kw of trackedKeywords) {
    const latestSnap = await RankSnapshot.findOne({ keywordId: kw._id }).sort({ date: -1 });
    const oldSnap = await RankSnapshot.findOne({
      keywordId: kw._id,
      date: { $lt: since },
    }).sort({ date: -1 });

    if (latestSnap && oldSnap) {
      if (latestSnap.position < oldSnap.position) keywordsUp++;
      else if (latestSnap.position > oldSnap.position) keywordsDown++;
    }
  }

  // 4. Competitor alerts in last 7 days
  const competitorAlerts = await Notification.countDocuments({
    userId: new mongoose.Types.ObjectId(userId),
    createdAt: { $gte: since },
  });

  // 5. Per-project breakdown
  const projectSummaries = await Promise.all(
    projects.map(async (p) => {
      const pCrawlJobs = await CrawlJob.find({
        projectId: p._id,
        completedAt: { $gte: since },
        status: 'completed',
      });
      const pAudits = pCrawlJobs.length;
      const pJobIds = pCrawlJobs.map((j) => j._id);

      const pCritical = await AuditIssue.countDocuments({
        crawlJobId: { $in: pJobIds },
        severity: 'critical',
      });

      const pKeywords = await TrackedKeyword.find({ projectId: p._id });
      let pUp = 0;
      let pDown = 0;
      for (const kw of pKeywords) {
        const latestSnap = await RankSnapshot.findOne({ keywordId: kw._id }).sort({ date: -1 });
        const oldSnap = await RankSnapshot.findOne({
          keywordId: kw._id,
          date: { $lt: since },
        }).sort({ date: -1 });
        if (latestSnap && oldSnap) {
          if (latestSnap.position < oldSnap.position) pUp++;
          else if (latestSnap.position > oldSnap.position) pDown++;
        }
      }

      const pAlerts = await Notification.countDocuments({
        userId: new mongoose.Types.ObjectId(userId),
        projectId: p._id,
        createdAt: { $gte: since },
      });

      return {
        projectName: p.name,
        auditsRun: pAudits,
        criticalIssues: pCritical,
        keywordsUp: pUp,
        keywordsDown: pDown,
        alerts: pAlerts,
      };
    })
  );

  return {
    auditsRun: recentCrawlJobs.length,
    newCriticalIssues,
    keywordsUp,
    keywordsDown,
    competitorAlerts,
    projectSummaries,
  };
};

const formatDigestEmail = (digest: WeeklyDigest, userName: string): string => {
  const totalKeywords = digest.keywordsUp + digest.keywordsDown;
  const lines: string[] = [];

  lines.push(`Hi ${userName},`);
  lines.push('');
  lines.push('Here is your weekly RankEngine AI digest:');
  lines.push('');

  lines.push(`• Audits run: ${digest.auditsRun}`);
  if (digest.newCriticalIssues > 0) {
    lines.push(`• New critical issues found: ${digest.newCriticalIssues}`);
  } else {
    lines.push('• New critical issues found: 0 — nice work!');
  }

  if (totalKeywords > 0) {
    lines.push(`• Rankings: ${digest.keywordsUp} improved, ${digest.keywordsDown} declined`);
  } else {
    lines.push('• No keywords are being tracked yet.');
  }

  if (digest.competitorAlerts > 0) {
    lines.push(`• Competitor alerts triggered: ${digest.competitorAlerts}`);
  }

  if (digest.projectSummaries.length > 1) {
    lines.push('');
    lines.push('Per-project breakdown:');
    for (const ps of digest.projectSummaries) {
      const parts = [`  ${ps.projectName}: ${ps.auditsRun} audit(s)`];
      if (ps.criticalIssues > 0) parts.push(`${ps.criticalIssues} critical`);
      const kwTotal = ps.keywordsUp + ps.keywordsDown;
      if (kwTotal > 0) parts.push(`${ps.keywordsUp} up / ${ps.keywordsDown} down`);
      if (ps.alerts > 0) parts.push(`${ps.alerts} alert(s)`);
      lines.push(parts.join(', '));
    }
  }

  lines.push('');
  lines.push('View full dashboard: https://app.rankengine.ai/dashboard');
  lines.push('');
  lines.push('— RankEngine AI');

  return lines.join('\n');
};

export const sendWeeklyDigests = async (): Promise<number> => {
  const users = await User.find({ emailDigestEnabled: true });
  let sent = 0;

  for (const user of users) {
    try {
      const digest = await buildDigestForUser(user._id.toString());
      if (!digest) continue;

      const emailService = getEmailService();
      const textBody = formatDigestEmail(digest, user.companyName || user.email);
      await emailService.sendEmail(
        user.email,
        `Your weekly RankEngine AI digest — ${new Date().toLocaleDateString()}`,
        textBody
      );
      sent++;
      console.log(`[WeeklyDigest]: Sent digest to ${user.email}`);
    } catch (err) {
      console.error(`[WeeklyDigest]: Failed to send digest to ${user.email}:`, err);
    }
  }

  console.log(`[WeeklyDigest]: Sent ${sent} digests`);
  return sent;
};

export const initWeeklyDigestScheduler = () => {
  if (process.env.NODE_ENV === 'test') return;

  cron.schedule('0 8 * * 1', async () => {
    console.log('[WeeklyDigest Scheduler]: Sending weekly digests...');
    await sendWeeklyDigests();
  });
  console.log('[WeeklyDigest Scheduler]: Weekly digests scheduled for Monday 8am (0 8 * * 1).');
};
