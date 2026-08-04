import { QueueEvents } from 'bullmq';
import redisConnection from './redisConnection';
import { CrawlJob } from '../models/CrawlJob';
import { computeAndStoreHealthScore } from '../services/healthScoreService';
import { syncProjectGraph } from '../services/graphService';
import { indexProjectContent } from '../services/vectorService';

type CrawlCompletionResult = {
  pageCount: number;
  rawResultsRef?: string;
};

/**
 * BullMQ serializes a worker return value on Redis. Accept both its serialized
 * form and the object form used by adapters/tests, without inventing a result
 * reference when the worker did not provide one.
 */
export const parseCrawlCompletionResult = (returnvalue: unknown): CrawlCompletionResult => {
  let value = returnvalue;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { pageCount: 0 };
    }
  }

  if (!value || typeof value !== 'object') {
    return { pageCount: 0 };
  }

  const result = value as Record<string, unknown>;
  const pageCount = typeof result.pageCount === 'number' ? result.pageCount : 0;
  const rawResultsRef =
    typeof result.rawResultsRef === 'string' && result.rawResultsRef.trim()
      ? result.rawResultsRef
      : undefined;

  return { pageCount, rawResultsRef };
};

export const crawlQueueEvents = new QueueEvents('crawl-jobs', {
  connection: redisConnection,
});

// Listener when job is in waiting list (queued)
crawlQueueEvents.on('waiting', async ({ jobId }) => {
  console.log(`[QueueEvents]: Job ${jobId} entered waiting state (queued)`);
  try {
    await CrawlJob.findByIdAndUpdate(jobId, {
      status: 'queued',
    });
  } catch (error) {
    console.error(`Failed to update status to queued for Job ${jobId}:`, error);
  }
});

// Listener when job starts processing (running)
crawlQueueEvents.on('active', async ({ jobId }) => {
  console.log(`[QueueEvents]: Job ${jobId} is now active (running)`);
  try {
    await CrawlJob.findByIdAndUpdate(jobId, {
      status: 'running',
      startedAt: new Date(),
    });
  } catch (error) {
    console.error(`Failed to update status to running for Job ${jobId}:`, error);
  }
});

// Listener when job finishes (completed)
crawlQueueEvents.on('completed', async ({ jobId, returnvalue }) => {
  console.log(`[QueueEvents]: Job ${jobId} completed successfully`);
  try {
    const { pageCount, rawResultsRef } = parseCrawlCompletionResult(returnvalue);
    const update: Record<string, unknown> = {
      status: 'completed',
      completedAt: new Date(),
      pageCount,
    };

    if (rawResultsRef) {
      update.rawResultsRef = rawResultsRef;
    } else {
      console.warn(
        `[QueueEvents]: Job ${jobId} completed without a valid rawResultsRef; leaving CrawlJob.rawResultsRef unset`
      );
    }

    const crawlJob = await CrawlJob.findByIdAndUpdate(jobId, update, { new: true });

    // Compute and persist the SEO Health Score from the audit issues
    try {
      await computeAndStoreHealthScore(jobId);
    } catch (hsError) {
      console.error(`Failed to compute health score for Job ${jobId}:`, hsError);
    }

    // Automatically trigger Neo4j graph sync and vector indexing for the completed project
    if (crawlJob && crawlJob.projectId) {
      const pid = crawlJob.projectId.toString();

      try {
        await syncProjectGraph(pid);
      } catch (graphError) {
        console.error(`Failed to sync project graph for Job ${jobId}:`, graphError);
      }

      try {
        await indexProjectContent(pid);
      } catch (vectorError) {
        console.error(`Failed to index vector content for Job ${jobId}:`, vectorError);
      }
    }
  } catch (error) {
    console.error(`Failed to update status to completed for Job ${jobId}:`, error);
  }
});

// Listener when job throws an error (failed)
crawlQueueEvents.on('failed', async ({ jobId, failedReason }) => {
  console.error(`[QueueEvents]: Job ${jobId} failed. Reason: ${failedReason}`);
  try {
    await CrawlJob.findByIdAndUpdate(jobId, {
      status: 'failed',
      completedAt: new Date(),
      errorMessage: failedReason || 'Job failed during queue execution',
    });
  } catch (error) {
    console.error(`Failed to update status to failed for Job ${jobId}:`, error);
  }
});

export default crawlQueueEvents;
