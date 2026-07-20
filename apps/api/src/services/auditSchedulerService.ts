import cron from 'node-cron';
import { Project } from '../models/Project';
import { Organization } from '../models/Organization';
import { CrawlJob } from '../models/CrawlJob';
import { AuditIssue } from '../models/AuditIssue';
import { Notification } from '../models/Notification';
import { enqueueCrawlJob } from './crawlService';

const getPreviousCrawlJob = async (projectId: string, currentJobId: string) => {
  return CrawlJob.findOne({
    projectId,
    _id: { $ne: currentJobId },
    status: 'completed',
  }).sort({ completedAt: -1 });
};

const getCriticalCount = async (crawlJobId: string): Promise<number> => {
  return AuditIssue.countDocuments({ crawlJobId, severity: 'critical' });
};

export const runAutoAudits = async (): Promise<void> => {
  const today = new Date();
  const isMonday = today.getDay() === 1;

  const schedules = isMonday ? ['daily', 'weekly'] : ['daily'];

  const projects = await Project.find({
    auditSchedule: { $in: schedules },
    deletedAt: null,
  });

  console.log(`[AuditScheduler]: Found ${projects.length} projects for auto-audit`);

  for (const project of projects) {
    try {
      const { crawlJobId } = await enqueueCrawlJob(project);
      console.log(`[AuditScheduler]: Enqueued crawl job ${crawlJobId} for project ${project._id}`);
    } catch (err) {
      console.error(`[AuditScheduler]: Failed to enqueue crawl for project ${project._id}:`, err);
    }
  }
};

const POLL_INTERVAL_MS = 10000;

export const monitorCompletedAudits = async (): Promise<void> => {
  const recentJobs = await CrawlJob.find({
    status: 'completed',
    completedAt: { $gte: new Date(Date.now() - POLL_INTERVAL_MS - 5000) },
  });

  for (const job of recentJobs) {
    try {
      const project = await Project.findById(job.projectId);
      if (!project) continue;

      if (project.auditSchedule === 'manual') continue;

      const prevJob = await getPreviousCrawlJob(project._id.toString(), job._id.toString());
      if (!prevJob) continue;

      const currentCritical = await getCriticalCount(job._id.toString());
      const previousCritical = await getCriticalCount(prevJob._id.toString());

      if (currentCritical > previousCritical) {
        const increase = currentCritical - previousCritical;
        const message = `Critical issues increased from ${previousCritical} to ${currentCritical} (+${increase}) in latest automatic audit for "${project.name}"`;

        const org = await Organization.findById(project.organizationId);

        const notification = new Notification({
          userId: org ? org.ownerId : project.organizationId,
          projectId: project._id,
          message,
        });
        await notification.save();

        console.log(
          `[AuditScheduler]: Notification created for project ${project._id}: ${message}`
        );
      }
    } catch (err) {
      console.error(`[AuditScheduler]: Error processing completed job ${job._id}:`, err);
    }
  }
};

export const initAuditScheduler = () => {
  if (process.env.NODE_ENV === 'test') return;

  cron.schedule('0 0 * * *', async () => {
    console.log('[AuditScheduler]: Running daily auto-audit check...');
    await runAutoAudits();
  });
  console.log('[AuditScheduler]: Daily auto-audit scheduled at midnight (0 0 * * *).');

  setInterval(async () => {
    await monitorCompletedAudits();
  }, POLL_INTERVAL_MS);
  console.log(`[AuditScheduler]: Monitoring completed audits every ${POLL_INTERVAL_MS / 1000}s`);
};
