import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import requireAuth from '../middleware/requireAuth';
import { requirePlan } from '../middleware/requirePlan';
import { Project } from '../models/Project';
import { TrackedKeyword } from '../models/TrackedKeyword';
import { RankSnapshot } from '../models/RankSnapshot';
import { collectRankSnapshotForKeyword } from '../services/rankTrackerService';

const router = Router();

const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

const trackKeywordSchema = z.object({
  keyword: z.string().min(1, 'Keyword is required'),
  targetUrl: z.string().url('Target URL must be a valid absolute URL'),
  competitorDomains: z.array(z.string()).default([]),
});

// POST /api/projects/:id/keywords - Track a new keyword
router.post('/:id/keywords', requireAuth, requirePlan('keywordTracking'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.ownerId.toString() !== req.user?.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this project' });
    }

    const validation = trackKeywordSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const { keyword, targetUrl, competitorDomains } = validation.data;

    const tracked = new TrackedKeyword({
      projectId: project._id,
      keyword,
      targetUrl,
      competitorDomains,
    });

    await tracked.save();

    // Proactively fetch initial ranking snapshot instantly so the database has immediate data
    await collectRankSnapshotForKeyword(
      project._id.toString(),
      tracked._id.toString(),
      keyword,
      targetUrl
    );

    return res.status(201).json(tracked);
  } catch (error) {
    console.error('Track keyword error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/keywords - List all tracked keywords with current positions and 7-day trend
router.get('/:id/keywords', requireAuth, requirePlan('keywordTracking'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.ownerId.toString() !== req.user?.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this project' });
    }

    const keywords = await TrackedKeyword.find({ projectId: project._id });

    const results = await Promise.all(
      keywords.map(async (kw) => {
        // Fetch last 7 days of snaps for trend arrow / sparks chart
        const snaps = await RankSnapshot.find({ keywordId: kw._id }).sort({ date: -1 }).limit(7);

        // Reverse to chronological order (oldest first)
        const sortedSnaps = [...snaps].reverse();

        const latestSnap = snaps[0];
        const currentPosition = latestSnap ? latestSnap.position : 101;
        const aioPresence = latestSnap ? latestSnap.aioPresence : false;

        // Calculate 7-day trend arrow indicator (up, down, stable)
        // Check rank 7 days ago vs today
        let trend: 'up' | 'down' | 'stable' = 'stable';
        if (snaps.length >= 2) {
          const oldestSnap = snaps[snaps.length - 1];
          const latestPos = latestSnap.position;
          const oldestPos = oldestSnap.position;

          if (latestPos < oldestPos) {
            trend = 'up'; // Rank number decreased (improved ranking!)
          } else if (latestPos > oldestPos) {
            trend = 'down'; // Rank number increased (fell in ranking)
          }
        }

        return {
          _id: kw._id,
          keyword: kw.keyword,
          targetUrl: kw.targetUrl,
          competitorDomains: kw.competitorDomains,
          currentPosition,
          aioPresence,
          trend,
          history7Days: sortedSnaps.map((s) => ({
            position: s.position,
            date: s.date.toISOString().split('T')[0],
          })),
        };
      })
    );

    return res.json(results);
  } catch (error) {
    console.error('List keywords error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/keywords/:keywordId/history - Get 30 days history for line chart
router.get('/:id/keywords/:keywordId/history', requireAuth, requirePlan('keywordTracking'), async (req: Request, res: Response) => {
  try {
    const { id, keywordId } = req.params;
    if (!isValidObjectId(id) || !isValidObjectId(keywordId)) {
      return res.status(400).json({ error: 'Invalid ID formats' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.ownerId.toString() !== req.user?.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this project' });
    }

    const kw = await TrackedKeyword.findOne({ _id: keywordId, projectId: project._id });
    if (!kw) {
      return res.status(404).json({ error: 'Tracked keyword not found in project' });
    }

    // Retrieve last 30 snapshots
    const snaps = await RankSnapshot.find({ keywordId: kw._id }).sort({ date: -1 }).limit(30);

    // Reverse to chronological order (oldest first)
    const history = [...snaps].reverse().map((s) => ({
      position: s.position,
      aioPresence: s.aioPresence,
      date: s.date.toISOString().split('T')[0],
    }));

    return res.json({
      keyword: kw.keyword,
      targetUrl: kw.targetUrl,
      history,
    });
  } catch (error) {
    console.error('Get keyword history error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/suggested-keywords - List non-dismissed keyword suggestions
router.get('/:id/suggested-keywords', requireAuth, requirePlan('keywordTracking'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.ownerId.toString() !== req.user?.userId) {
      return res.status(403).json({ error: 'Forbidden: You do not own this project' });
    }

    const active = (project.suggestedKeywords || []).filter((sk) => !sk.dismissed);
    return res.json(active);
  } catch (error) {
    console.error('List suggested keywords error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/suggested-keywords/:index/dismiss - Dismiss a suggested keyword by array index
router.post(
  '/:id/suggested-keywords/:index/dismiss',
  requireAuth,
  requirePlan('keywordTracking'),
  async (req: Request, res: Response) => {
    try {
      const { id, index } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid project ID format' });
      }

      const project = await Project.findOne({ _id: id, deletedAt: null });
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      if (project.ownerId.toString() !== req.user?.userId) {
        return res.status(403).json({ error: 'Forbidden: You do not own this project' });
      }

      const idx = parseInt(index, 10);
      if (isNaN(idx) || idx < 0 || idx >= (project.suggestedKeywords || []).length) {
        return res.status(400).json({ error: 'Invalid index' });
      }

      project.suggestedKeywords[idx].dismissed = true;
      await project.save();

      return res.json({ message: 'Keyword suggestion dismissed' });
    } catch (error) {
      console.error('Dismiss suggested keyword error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
