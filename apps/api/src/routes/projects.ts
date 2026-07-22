import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Project } from '../models/Project';
import { CrawlJob } from '../models/CrawlJob';
import { enqueueCrawlJob, enqueueMigrationCheck } from '../services/crawlService';

const router = Router();

const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').trim(),
  domain: z.string().min(1, 'Domain is required').trim(),
  stagingDomain: z.string().trim().optional(),
  triggerFirstAudit: z.boolean().optional(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1, 'Project name cannot be empty').trim().optional(),
  domain: z.string().min(1, 'Domain cannot be empty').trim().optional(),
  stagingDomain: z.string().trim().optional(),
});

const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

// POST /api/projects - Create a new project
router.post('/', async (req: Request, res: Response) => {
  try {
    const validation = createProjectSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const { name, domain, stagingDomain, triggerFirstAudit } = validation.data;

    const project = new Project({
      name,
      domain,
      stagingDomain,
    });

    await project.save();

    let firstCrawlJobId: string | undefined;
    if (triggerFirstAudit) {
      try {
        const result = await enqueueCrawlJob(project);
        firstCrawlJobId = result.crawlJobId;
      } catch (err) {
        console.error('First audit enqueue error:', err);
      }
    }

    const response = project.toObject() as unknown as Record<string, unknown>;
    if (firstCrawlJobId) {
      response._firstCrawlJobId = firstCrawlJobId;
    }
    return res.status(201).json(response);
  } catch (error) {
    console.error('Create project error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects - List all active projects
router.get('/', async (_req: Request, res: Response) => {
  try {
    const projects = await Project.find({ deletedAt: null });
    return res.json(projects);
  } catch (error) {
    console.error('List projects error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id - Get one project by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    return res.json(project);
  } catch (error) {
    console.error('Get project error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/latest-crawl - Get the latest crawl job status for a project
router.get('/:id/latest-crawl', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const latestJob = await CrawlJob.findOne({
      projectId: id,
      type: { $ne: 'migration-check' },
    }).sort({ createdAt: -1 });
    const latestMigrationJob = await CrawlJob.findOne({
      projectId: id,
      type: 'migration-check',
    }).sort({ createdAt: -1 });

    return res.json({
      latestJob,
      latestMigrationJob,
    });
  } catch (error) {
    console.error('Get latest crawl job error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/projects/:id - Update project metadata
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const validation = updateProjectSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const oldStagingDomain = project.stagingDomain;

    const updates = validation.data;
    if (updates.name !== undefined) project.name = updates.name;
    if (updates.domain !== undefined) project.domain = updates.domain;
    if (updates.stagingDomain !== undefined) project.stagingDomain = updates.stagingDomain;

    await project.save();

    let migrationCheckJobId: string | undefined;
    if (
      updates.stagingDomain !== undefined &&
      updates.stagingDomain.trim() !== '' &&
      updates.stagingDomain !== oldStagingDomain
    ) {
      try {
        const result = await enqueueMigrationCheck(project);
        migrationCheckJobId = result.crawlJobId;
      } catch (err) {
        console.error('Auto migration check enqueue error:', err);
      }
    }

    const response = project.toObject() as unknown as Record<string, unknown>;
    if (migrationCheckJobId) {
      response._migrationCheckJobId = migrationCheckJobId;
    }
    return res.json(response);
  } catch (error) {
    console.error('Update project error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

const auditScheduleSchema = z.object({
  auditSchedule: z.enum(['manual', 'daily', 'weekly']),
});

// PATCH /api/projects/:id/schedule - Update audit schedule
router.patch('/:id/schedule', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const validation = auditScheduleSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    project.auditSchedule = validation.data.auditSchedule;
    await project.save();

    return res.json(project);
  } catch (error) {
    console.error('Update audit schedule error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id - Soft-delete project
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    project.deletedAt = new Date();
    await project.save();

    return res.json({ message: 'Project soft-deleted successfully' });
  } catch (error) {
    console.error('Delete project error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/crawl - Enqueue a crawl job for a project
router.post('/:id/crawl', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { crawlJobId } = await enqueueCrawlJob(project);

    return res.status(202).json({
      message: 'Crawl job queued successfully',
      crawlJobId,
    });
  } catch (error) {
    console.error('Queue crawl job error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/migration-check - Trigger a migration redirect audit
router.post('/:id/migration-check', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.stagingDomain) {
      return res.status(400).json({ error: 'Staging domain is not configured for this project' });
    }

    const { crawlJobId } = await enqueueMigrationCheck(project);

    return res.status(202).json({
      message: 'Migration check queued successfully',
      crawlJobId,
    });
  } catch (error) {
    console.error('Queue migration check error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
