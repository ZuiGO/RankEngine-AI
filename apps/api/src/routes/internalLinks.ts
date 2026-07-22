import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Project } from '../models/Project';
import CrawlJob from '../models/CrawlJob';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

router.get('/:id/internal-links', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const latestCrawl = await CrawlJob.findOne({ projectId: id, status: 'completed' })
      .sort({ completedAt: -1 })
      .lean();

    if (!latestCrawl) {
      return res.json({ suggestions: [] });
    }

    const db = mongoose.connection.db;
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }

    const doc = await db.collection('link_suggestions').findOne({ crawlJobId: new mongoose.Types.ObjectId(latestCrawl._id) });

    return res.json({ suggestions: (doc?.suggestions as Array<{ sourcePage: string; targetPage: string; suggestedAnchorText: string }>) || [] });
  } catch (error) {
    console.error('[InternalLinks] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
