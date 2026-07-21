import { Router, Request, Response } from 'express';
import axios from 'axios';
import { SerpAnalysis } from '../models/SerpAnalysis';
import {
  getSerpProvider,
  extractTextAndWordCount,
  analyzeSerpContentWithLlm,
} from '../services/serpService';

const router = Router();

const getTodayDateString = (): string => {
  return new Date().toISOString().split('T')[0];
};

router.post('/serp-analysis', async (req: Request, res: Response) => {
  try {
    const { keyword } = req.body;
    if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
      return res.status(400).json({ error: 'Keyword is required and must be a non-empty string' });
    }

    const cleanKeyword = keyword.toLowerCase().trim();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const cachedAnalysis = await SerpAnalysis.findOne({
      keyword: cleanKeyword,
      createdAt: { $gte: cutoff },
    });

    if (cachedAnalysis) {
      console.log(`[SerpAnalysis]: Cache hit for keyword: "${cleanKeyword}"`);
      return res.json({
        keyword: cachedAnalysis.keyword,
        avgWordCount: cachedAnalysis.avgWordCount,
        sharedEntities: cachedAnalysis.sharedEntities,
        sharedSubtopics: cachedAnalysis.sharedSubtopics,
        competitors: cachedAnalysis.competitors.map((c) => ({
          url: c.url,
          wordCount: c.wordCount,
          title: c.title,
        })),
      });
    }

    console.log(`[SerpAnalysis]: Cache miss for keyword: "${cleanKeyword}". Running analysis.`);

    const serpProvider = getSerpProvider();
    const serpResults = await serpProvider.fetchTop10(cleanKeyword);

    if (!serpResults || serpResults.length === 0) {
      return res.status(500).json({ error: 'Failed to fetch competitor organic search results' });
    }

    const crawlPromises = serpResults.map(async (item) => {
      try {
        const response = await axios.get(item.url, {
          timeout: 3000,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          },
          validateStatus: () => true,
        });

        const html = response.data;
        if (typeof html === 'string') {
          const { text, wordCount } = extractTextAndWordCount(html);
          return { url: item.url, title: item.title, wordCount, text };
        }
      } catch (err: any) {
        console.error(`[SerpAnalysis] Failed fetching competitor URL '${item.url}':`, err.message);
      }

      return { url: item.url, title: item.title, wordCount: 0, text: '' };
    });

    const competitorsData = await Promise.all(crawlPromises);

    const competitorTexts = competitorsData.map((c) => c.text).filter((t) => t.length > 0);
    const llmAnalysis = await analyzeSerpContentWithLlm(cleanKeyword, competitorTexts);

    const totalWordCount = competitorsData.reduce((sum, c) => sum + c.wordCount, 0);
    const avgWordCount =
      competitorsData.length > 0 ? Math.round(totalWordCount / competitorsData.length) : 0;

    const competitors = competitorsData.map((c) => ({
      url: c.url,
      wordCount: c.wordCount,
      title: c.title,
    }));

    const analysisDoc = new SerpAnalysis({
      keyword: cleanKeyword,
      date: getTodayDateString(),
      avgWordCount,
      sharedEntities: llmAnalysis.sharedEntities,
      sharedSubtopics: llmAnalysis.sharedSubtopics,
      competitors,
    });

    try {
      await analysisDoc.save();
    } catch (saveErr: any) {
      console.warn('[SerpAnalysis] Duplicate cache save race condition bypassed:', saveErr.message);
    }

    return res.json({
      keyword: cleanKeyword,
      avgWordCount,
      sharedEntities: llmAnalysis.sharedEntities,
      sharedSubtopics: llmAnalysis.sharedSubtopics,
      competitors,
    });
  } catch (error) {
    console.error('SERP analysis feature failed:', error);
    return res.status(500).json({ error: 'Internal server error during SERP analysis' });
  }
});

import { rateLimiter } from '../middleware/rateLimiter';
import { gradeContent } from '../services/graderService';

router.post(
  '/grade',
  rateLimiter(10, 1000),
  async (req: Request, res: Response) => {
    try {
      const { text, targetKeyword, sharedEntities } = req.body;

      if (typeof text !== 'string') {
        return res.status(400).json({ error: 'Text content must be a valid string' });
      }

      const gradeResult = gradeContent(text, targetKeyword, sharedEntities);
      return res.json(gradeResult);
    } catch (error) {
      console.error('Content grading failed:', error);
      return res.status(500).json({ error: 'Internal server error during content grading' });
    }
  }
);

export default router;
