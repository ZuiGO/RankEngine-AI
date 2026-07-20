import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { CrawlJob } from '../models/CrawlJob';
import { Project } from '../models/Project';
import { AuditIssue } from '../models/AuditIssue';
import requireAuth from '../middleware/requireAuth';

const router = Router();

router.use(requireAuth);

// GET /api/crawl-jobs/:id - Query crawl job status and aggregate results summary
router.get('/:id', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid crawl job ID format' });
    }

    const crawlJob = await CrawlJob.findById(id);
    if (!crawlJob) {
      return res.status(404).json({ error: 'Crawl job not found' });
    }

    // Verify parent project ownership to protect tenant isolation
    const project = await Project.findById(crawlJob.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Associated project not found' });
    }

    if (project.ownerId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this project' });
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

    // Otherwise, return job state directly
    return res.json({ crawlJob });
  } catch (error) {
    console.error('Get crawl job status error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/crawl-jobs/:id/issues - Fetch audit issues for a specific crawl job
router.get('/:id/issues', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid crawl job ID format' });
    }

    const crawlJob = await CrawlJob.findById(id);
    if (!crawlJob) {
      return res.status(404).json({ error: 'Crawl job not found' });
    }

    // Verify parent project ownership
    const project = await Project.findById(crawlJob.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Associated project not found' });
    }

    if (project.ownerId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this project' });
    }

    // Build filter
    const filter: any = { crawlJobId: id };
    if (req.query.category) {
      filter.category = req.query.category;
    }

    const issues = await AuditIssue.find(filter);
    return res.json({ issues });
  } catch (error) {
    console.error('Get crawl job issues error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/crawl-jobs/:id/checklist - Fetch checklist grouped by severity
router.get('/:id/checklist', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid crawl job ID format' });
    }

    const crawlJob = await CrawlJob.findById(id);
    if (!crawlJob) {
      return res.status(404).json({ error: 'Crawl job not found' });
    }

    // Verify parent project ownership
    const project = await Project.findById(crawlJob.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Associated project not found' });
    }

    if (project.ownerId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this project' });
    }

    // Fetch all issues related to the crawl job
    const issues = await AuditIssue.find({ crawlJobId: id });

    // Group issues by severity, excluding schema category
    const checklist = {
      critical: issues.filter((i) => i.severity === 'critical' && i.category !== 'schema'),
      warning: issues.filter((i) => i.severity === 'warning' && i.category !== 'schema'),
      passed: issues.filter((i) => i.severity === 'passed' && i.category !== 'schema'),
    };

    // Schema audit issues section
    const schema = issues.filter((i) => i.category === 'schema');

    return res.json({ checklist, schema });
  } catch (error) {
    console.error('Get crawl job checklist error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
