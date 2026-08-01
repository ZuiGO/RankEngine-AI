import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { generateSiteReport, NoCompletedCrawlError as SiteReportNoCrawlError } from '../services/siteReportService';
import { getActionItems, NoCompletedCrawlError as ActionItemsNoCrawlError } from '../services/actionItemsService';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

/**
 * GET /api/projects/:id/report
 *
 * Returns everything the consolidated report screen needs in a single round-trip:
 *   { report: SiteReport, actionItems: ActionItem[] }
 *
 * Both datasets are assembled from data already produced by a completed crawl.
 * No new crawling, LLM calls, or external API calls are made here.
 *
 * Error responses:
 *   400 { error, code: 'NO_COMPLETED_CRAWL' }  — project exists but has never been audited
 *   400 { error }                               — malformed project ID
 *   500 { error }                               — unexpected failure
 */
router.get('/:id/report', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    // Run both aggregations in parallel — they are independent reads.
    // If either throws NoCompletedCrawlError we surface a 400 immediately.
    let report: Awaited<ReturnType<typeof generateSiteReport>>;
    let actionItems: Awaited<ReturnType<typeof getActionItems>>;

    try {
      [report, actionItems] = await Promise.all([
        generateSiteReport(id),
        getActionItems(id),
      ]);
    } catch (err: unknown) {
      // Both services share the same sentinel error class name and message
      // convention. Catch either variant.
      if (
        err instanceof SiteReportNoCrawlError ||
        err instanceof ActionItemsNoCrawlError
      ) {
        return res.status(400).json({
          error: 'No completed audit found for this project. Run an audit first.',
          code: 'NO_COMPLETED_CRAWL',
        });
      }
      throw err; // re-throw unexpected errors to the outer catch
    }

    return res.json({ report, actionItems });
  } catch (error) {
    console.error('[SiteReport] GET /:id/report error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
