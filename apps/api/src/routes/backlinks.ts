import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import requireAuth from '../middleware/requireAuth';
import { Project } from '../models/Project';
import {
  getBacklinkOverview,
  getBacklinkList,
  DataProviderQuotaError,
} from '../services/dataProviderService';

const router = Router();

const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

// GET /api/projects/:id/backlinks/overview?domain=...
router.get('/:id/backlinks/overview', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.ownerId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this project' });
    }

    const schema = z.object({
      domain: z.string().min(1).max(500),
    });
    const validation = schema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const data = await getBacklinkOverview(req.user.userId, validation.data.domain);
    return res.json(data);
  } catch (error) {
    if (error instanceof DataProviderQuotaError) {
      return res.status(429).json({
        error: error.message,
        retryAfterMs: error.retryAfterMs,
      });
    }
    console.error('[Backlinks Overview] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/backlinks/list?domain=...&limit=...
router.get('/:id/backlinks/list', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.ownerId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this project' });
    }

    const schema = z.object({
      domain: z.string().min(1).max(500),
      limit: z.coerce.number().min(1).max(1000).default(100),
    });
    const validation = schema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const { domain, limit } = validation.data;
    const items = await getBacklinkList(req.user.userId, domain, limit);
    return res.json(items);
  } catch (error) {
    if (error instanceof DataProviderQuotaError) {
      return res.status(429).json({
        error: error.message,
        retryAfterMs: error.retryAfterMs,
      });
    }
    console.error('[Backlinks List] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
