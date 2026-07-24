import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getKeywordIdeas, DataProviderQuotaError, isUsingMockProvider } from '../services/dataProviderService';
import KeywordResearchQuery from '../models/KeywordResearchQuery';
import { callGroq, LlmError } from '../services/llmService';

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

    try {
      await KeywordResearchQuery.create({ seedKeyword, locationCode, timestamp: new Date() });
    } catch (histErr) {
      console.warn('[KeywordResearch] Could not save history query:', histErr);
    }

    return res.json({ seedKeyword, results, isMockData: isUsingMockProvider() });
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

const clusterRequestSchema = z.object({
  keywords: z.array(z.string().min(1)).min(2).max(300),
});

router.post('/keyword-research/cluster', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (Array.isArray(body?.keywords) && body.keywords.length > 300) {
      return res.status(400).json({ error: 'Maximum 300 keywords per clustering request' });
    }

    const validation = clusterRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const { keywords } = validation.data;

    const buildPrompt = () =>
      `You are an expert SEO keyword strategist. Group the following keywords into topic clusters based on search intent and topic relevance.

Return valid JSON with this exact schema:
{
  "clusters": [
    {
      "topicName": "string (descriptive cluster name)",
      "keywords": ["string (keywords belonging to this cluster)"]
    }
  ]
}

Requirements:
- Every input keyword must appear in exactly one cluster
- No keyword should be duplicated across clusters
- No keyword should be left out
- Create 2 to 8 clusters depending on the variety of topics

Keywords: ${keywords.join(', ')}`;

    const attempt = () =>
      callGroq<{ clusters: { topicName: string; keywords: string[] }[] }>(buildPrompt(), 60000);

    const validateCoverage = (result: { clusters: { topicName: string; keywords: string[] }[] }): boolean => {
      const assigned = new Set<string>();
      for (const cluster of result.clusters) {
        for (const kw of cluster.keywords) {
          if (assigned.has(kw)) return false;
          assigned.add(kw);
        }
      }
      return keywords.every(kw => assigned.has(kw));
    };

    let result = await attempt();
    if (!validateCoverage(result)) {
      result = await attempt();
      if (!validateCoverage(result)) {
        return res.status(502).json({ error: 'Could not generate valid clusters after retry' });
      }
    }

    return res.json(result);
  } catch (error) {
    if (error instanceof LlmError) {
      return res.status(502).json({ error: error.message });
    }
    console.error('[KeywordCluster] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
