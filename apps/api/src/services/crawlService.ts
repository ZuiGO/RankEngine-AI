import { Project } from '../models/Project';
import { CrawlJob } from '../models/CrawlJob';
import { crawlQueue } from '../queues/crawlQueue';

export interface EnqueueCrawlJobResult {
  crawlJobId: string;
}

export const enqueueCrawlJob = async (
  project: InstanceType<typeof Project>
): Promise<EnqueueCrawlJobResult> => {
  const crawlJob = new CrawlJob({
    projectId: project._id,
    type: 'crawl',
    status: 'queued',
    pageCount: 0,
  });
  await crawlJob.save();

  const crawlJobIdStr = crawlJob._id.toString();

  await crawlQueue.add(
    'crawl',
    {
      crawlJobId: crawlJobIdStr,
      domain: project.domain,
      stagingDomain: project.stagingDomain || null,
    },
    {
      jobId: crawlJobIdStr,
    }
  );

  return { crawlJobId: crawlJobIdStr };
};

export const enqueueMigrationCheck = async (
  project: InstanceType<typeof Project>
): Promise<EnqueueCrawlJobResult> => {
  const crawlJob = new CrawlJob({
    projectId: project._id,
    type: 'migration-check',
    status: 'queued',
    pageCount: 0,
  });
  await crawlJob.save();

  const crawlJobIdStr = crawlJob._id.toString();

  await crawlQueue.add(
    'crawl',
    {
      crawlJobId: crawlJobIdStr,
      domain: project.domain,
      stagingDomain: project.stagingDomain,
      type: 'migration-check',
    },
    {
      jobId: crawlJobIdStr,
    }
  );

  return { crawlJobId: crawlJobIdStr };
};

export const cancelCrawlJob = async (crawlJobId: string): Promise<boolean> => {
  const crawlJob = await CrawlJob.findById(crawlJobId);
  if (!crawlJob) return false;

  // 1. Remove job from BullMQ queue if still queued/waiting
  try {
    const job = await crawlQueue.getJob(crawlJobId);
    if (job) {
      await job.remove();
    }
  } catch (err) {
    // Ignore queue removal errors if job was already active or dequeued
  }

  // 2. Mark status as failed in MongoDB
  crawlJob.status = 'failed';
  crawlJob.errorMessage = 'Cancelled by user';
  crawlJob.completedAt = new Date();
  await crawlJob.save();

  return true;
};
