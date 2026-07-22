import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Project } from '../models/Project';
import BacklinkSnapshot from '../models/BacklinkSnapshot';
import {
  getBacklinkOverview,
  getBacklinkList,
  DataProviderQuotaError,
  isUsingMockProvider,
} from '../services/dataProviderService';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

const getDateBucket = (date: Date = new Date()): string => date.toISOString().split('T')[0];

const isCacheFresh = (cachedAt: Date, ttlMs: number): boolean =>
  Date.now() - cachedAt.getTime() < ttlMs;

const CACHE_TTL_SNAPSHOT = 3 * 24 * 60 * 60 * 1000;

const SPAM_ANCHOR_PATTERNS = [
  'casino',
  'gambling',
  'bet',
  'poker',
  'slot',
  'pharmacy',
  'pharma',
  'viagra',
  'cialis',
  'levitra',
  'adult',
  'porn',
  'xxx',
  'escort',
  'payday loan',
  'quick cash',
  'debt consolidation',
  'free money',
  'work from home',
  'make money fast',
  'click here',
  'buy now',
  'cheap',
];

const SPAM_SCORE_THRESHOLD = 60;

const isToxic = (spamScore: number, anchorText: string): boolean => {
  if (spamScore > SPAM_SCORE_THRESHOLD) return true;
  const lower = anchorText.toLowerCase();
  return SPAM_ANCHOR_PATTERNS.some((pattern) => lower.includes(pattern));
};

const resolveProject = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    res.status(400).json({ error: 'Invalid project ID format' });
    return null;
  }
  const project = await Project.findOne({ _id: id, deletedAt: null });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  return project;
};

router.get('/:id/backlinks/overview', async (req: Request, res: Response) => {
  try {
    const project = await resolveProject(req, res);
    if (!project) return;

    const today = getDateBucket();

    const cached = await BacklinkSnapshot.findOne({
      projectId: project._id,
      date: today,
    });
    if (cached && isCacheFresh(cached.cachedAt, CACHE_TTL_SNAPSHOT)) {
      return res.json({
        totalBacklinks: cached.totalBacklinks,
        referringDomains: cached.referringDomains,
        authorityScore: cached.authorityScore,
        isMockData: isUsingMockProvider(),
      });
    }

    const data = await getBacklinkOverview(project.domain);

    const authorityScore = data.domainRating;

    await BacklinkSnapshot.findOneAndUpdate(
      { projectId: project._id, date: today },
      {
        projectId: project._id,
        date: today,
        totalBacklinks: data.totalBacklinks,
        referringDomains: data.referringDomains,
        authorityScore,
        cachedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    return res.json({
      totalBacklinks: data.totalBacklinks,
      referringDomains: data.referringDomains,
      authorityScore,
      isMockData: isUsingMockProvider(),
    });
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

router.get('/:id/backlinks/list', async (req: Request, res: Response) => {
  try {
    const project = await resolveProject(req, res);
    if (!project) return;

    const schema = z.object({
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(1000).default(100),
    });
    const validation = schema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const { page, limit } = validation.data;
    const offset = (page - 1) * limit;

    const items = await getBacklinkList(project.domain, limit, offset);

    const enriched = items.map((item) => ({
      ...item,
      toxic: isToxic(item.spamScore, item.anchorText),
    }));

    return res.json({
      page,
      limit,
      items: enriched,
      isMockData: isUsingMockProvider(),
    });
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

router.get('/:id/backlinks/snapshots', async (req: Request, res: Response) => {
  try {
    const project = await resolveProject(req, res);
    if (!project) return;

    const snapshots = await BacklinkSnapshot.find({ projectId: project._id })
      .sort({ date: 1 })
      .select('date totalBacklinks referringDomains authorityScore')
      .lean();

    return res.json(snapshots);
  } catch (error) {
    console.error('[Backlinks Snapshots] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
