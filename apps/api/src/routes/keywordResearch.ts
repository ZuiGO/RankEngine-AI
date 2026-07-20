import { Router, Request, Response } from 'express';
import { z } from 'zod';
import requireAuth from '../middleware/requireAuth';
import { getKeywordIdeas, DataProviderQuotaError } from '../services/dataProviderService';
import KeywordResearchQuery from '../models/KeywordResearchQuery';

const router = Router();

// POST /api/keyword-research — run keyword research for a seed keyword
router.post('/keyword-research', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const schema = z.object({
      seedKeyword: z.string().min(1).max(200),
      locationCode: z.string().optional(),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const { seedKeyword, locationCode } = validation.data;
    const results = await getKeywordIdeas(req.user.userId, seedKeyword, locationCode);

    await KeywordResearchQuery.create({
      userId: req.user.userId,
      seedKeyword: seedKeyword.trim(),
      locationCode: locationCode ?? null,
      timestamp: new Date(),
    });

    return res.json({ seedKeyword, results });
  } catch (error) {
    if (error instanceof DataProviderQuotaError) {
      return res.status(429).json({
        error: error.message,
        retryAfterMs: error.retryAfterMs,
      });
    }
    console.error('[KeywordResearch] POST error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/keyword-research/history — last 20 queries for the current user
router.get('/keyword-research/history', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const queries = await KeywordResearchQuery.find({ userId: req.user.userId })
      .sort({ timestamp: -1 })
      .limit(20)
      .select('seedKeyword locationCode timestamp')
      .lean();

    return res.json({ queries });
  } catch (error) {
    console.error('[KeywordResearch] GET history error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
