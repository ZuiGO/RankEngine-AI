import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Project } from '../models/Project';
import DomainOverviewSnapshot from '../models/DomainOverviewSnapshot';
import { getDomainOverview, DataProviderQuotaError } from '../services/dataProviderService';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

const getDateBucket = (date: Date = new Date()): string => date.toISOString().split('T')[0];

const isCacheFresh = (cachedAt: Date, ttlMs: number): boolean =>
  Date.now() - cachedAt.getTime() < ttlMs;

const CACHE_TTL_SNAPSHOT = 3 * 24 * 60 * 60 * 1000;

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

router.get('/:id/domain-overview', async (req: Request, res: Response) => {
  try {
    const project = await resolveProject(req, res);
    if (!project) return;

    const today = getDateBucket();

    const cached = await DomainOverviewSnapshot.findOne({
      projectId: project._id,
      date: today,
    });
    if (cached && isCacheFresh(cached.cachedAt, CACHE_TTL_SNAPSHOT)) {
      return res.json({
        organicTrafficEstimate: cached.organicTrafficEstimate,
        organicKeywordCount: cached.organicKeywordCount,
        topKeywords: cached.topKeywords,
      });
    }

    const data = await getDomainOverview(project.domain);

    await DomainOverviewSnapshot.findOneAndUpdate(
      { projectId: project._id, date: today },
      {
        projectId: project._id,
        date: today,
        organicTrafficEstimate: data.organicTrafficEstimate,
        organicKeywordCount: data.organicKeywordCount,
        topKeywords: data.topKeywords,
        cachedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    return res.json(data);
  } catch (error) {
    if (error instanceof DataProviderQuotaError) {
      return res.status(429).json({
        error: error.message,
        retryAfterMs: error.retryAfterMs,
      });
    }
    console.error('[DomainOverview] GET error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/domain-overview/compare', async (req: Request, res: Response) => {
  try {
    const project = await resolveProject(req, res);
    if (!project) return;

    const schema = z.object({
      competitors: z.array(z.string().min(1).max(500)).min(1).max(5),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const domains = [project.domain, ...validation.data.competitors];

    const results = await Promise.all(
      domains.map(async (domain) => {
        try {
          const data = await getDomainOverview(domain);
          return { domain, ...data, error: null };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          return {
            domain,
            organicTrafficEstimate: 0,
            organicKeywordCount: 0,
            topKeywords: [],
            error: message,
          };
        }
      })
    );

    return res.json({ comparison: results });
  } catch (error) {
    if (error instanceof DataProviderQuotaError) {
      return res.status(429).json({
        error: error.message,
        retryAfterMs: error.retryAfterMs,
      });
    }
    console.error('[DomainOverview] POST compare error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
