import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getKeywordIdeas, DataProviderQuotaError } from '../services/dataProviderService';
import KeywordResearchQuery from '../models/KeywordResearchQuery';

const router = Router();

router.post('/keyword-research', async (req: Request, res: Response) => {
  try {
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
    const results = await getKeywordIdeas(seedKeyword, locationCode);

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

router.get('/keyword-research/history', async (_req: Request, res: Response) => {
  try {
    const queries = await KeywordResearchQuery.find({})
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
