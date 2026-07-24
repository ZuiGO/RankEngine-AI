import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { CrawlJob } from '../models/CrawlJob';
import { AuditIssue } from '../models/AuditIssue';

const router = Router();

// GET /api/crawl-jobs/:id - Query crawl job status and aggregate results summary
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid crawl job ID format' });
    }

    const crawlJob = await CrawlJob.findById(id);
    if (!crawlJob) {
      return res.status(404).json({ error: 'Crawl job not found' });
    }

    // If completed, return detailed summary metrics
    if (crawlJob.status === 'completed') {
      const issues = await AuditIssue.find({ crawlJobId: id });

      const summary = {
        pageCount: crawlJob.pageCount,
        criticalCount: issues.filter((i) => i.severity === 'critical').length,
        warningCount: issues.filter((i) => i.severity === 'warning').length,
        passedCount: issues.filter((i) => i.severity === 'passed').length,
      };

      // Compute trend vs previous completed crawl for the same project
      let previousHealthScore: number | null = null;
      if (crawlJob.healthScore != null) {
        const previousJob = await CrawlJob.findOne({
          projectId: crawlJob.projectId,
          _id: { $ne: crawlJob._id },
          status: 'completed',
          healthScore: { $exists: true },
        }).sort({ completedAt: -1 });

        if (previousJob && previousJob.healthScore != null) {
          previousHealthScore = previousJob.healthScore;
        }
      }

      return res.json({
        crawlJob,
        summary,
        previousHealthScore,
      });
    }

    return res.json({ crawlJob });
  } catch (error) {
    console.error('Get crawl job status error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/crawl-jobs/:id/issues - Fetch audit issues for a specific crawl job
router.get('/:id/issues', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid crawl job ID format' });
    }

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
    const skip = (page - 1) * limit;

    const filter: any = { crawlJobId: id };
    if (req.query.category) {
      filter.category = req.query.category;
    }

    const [issues, total] = await Promise.all([
      AuditIssue.find(filter).skip(skip).limit(limit),
      AuditIssue.countDocuments(filter),
    ]);

    return res.json({ issues, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Get crawl job issues error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/crawl-jobs/:id/checklist - Fetch checklist grouped by severity
router.get('/:id/checklist', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid crawl job ID format' });
    }

    const crawlJob = await CrawlJob.findById(id);
    if (!crawlJob) {
      return res.status(404).json({ error: 'Crawl job not found' });
    }

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
    const skip = (page - 1) * limit;

    const baseFilter: any = { crawlJobId: id };
    const total = await AuditIssue.countDocuments(baseFilter);

    const issues = await AuditIssue.find(baseFilter).skip(skip).limit(limit);

    // Group non-schema issues by severity (schema items get their own section)
    const nonSchema = issues.filter((i) => i.category !== 'schema');
    const checklist = {
      critical: nonSchema.filter((i) => i.severity === 'critical'),
      warning: nonSchema.filter((i) => i.severity === 'warning'),
      passed: nonSchema.filter((i) => i.severity === 'passed'),
    };

    // Schema audit issues section (separate from severity groups)
    const schema = issues.filter((i) => i.category === 'schema');

    return res.json({
      checklist,
      schema,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Get crawl job checklist error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/crawl-jobs/:id/cancel - Stop/cancel an ongoing or queued audit
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid crawl job ID format' });
    }

    const { cancelCrawlJob } = await import('../services/crawlService');
    const success = await cancelCrawlJob(id);

    if (!success) {
      return res.status(404).json({ error: 'Crawl job not found' });
    }

    const updatedJob = await CrawlJob.findById(id);
    return res.json({ message: 'Audit job cancelled successfully', crawlJob: updatedJob });
  } catch (error) {
    console.error('Cancel crawl job error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
