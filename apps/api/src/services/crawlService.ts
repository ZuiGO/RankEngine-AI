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
