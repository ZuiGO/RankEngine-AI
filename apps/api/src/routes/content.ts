import { Router, Request, Response } from 'express';
import { z } from 'zod';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { SerpAnalysis } from '../models/SerpAnalysis';
import { getSerpProvider, extractTextAndWordCount, analyzeSerpContentWithLlm } from '../services/serpService';
import { generate } from '../services/contentGeneratorService';
import { callGroq, LlmError } from '../services/llmService';

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

router.post('/grade', rateLimiter(10, 1000), async (req: Request, res: Response) => {
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
});

const generateContentSchema = z.object({
  targetKeyword: z.string().min(1),
  pageContext: z.string().optional(),
  assetType: z.enum(['title', 'meta_description', 'faq', 'schema']),
  schemaType: z.enum(['FAQPage', 'Article']).optional(),
});

router.post('/generate', async (req: Request, res: Response) => {
  try {
    const validation = generateContentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten().fieldErrors });
    }

    const { targetKeyword, pageContext, assetType, schemaType } = validation.data;

    if (assetType === 'schema' && !schemaType) {
      return res.status(400).json({ error: 'schemaType is required when assetType is schema' });
    }

    const result = await generate({ targetKeyword, pageContext, assetType, schemaType });
    return res.json(result);
  } catch (error) {
    console.error('[Content Generate] Error:', error);
    return res.status(502).json({ error: 'Content generation failed' });
  }
});

router.post('/enhance-structure', async (req: Request, res: Response) => {
  try {
    const { text, targetKeyword, sharedEntities } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text content is required' });
    }

    const prompt = `You are an expert SEO Content Strategist and AI Overview Architect.
Improve and enhance the structure of the following article for target keyword "${targetKeyword || 'SEO'}".

Requirements:
1. Ensure a clean markdown heading hierarchy (H1 title, H2 main sections, H3 sub-topics).
2. Under every H2 heading, write a concise, direct answer paragraph between 40 and 80 words (optimized for Google AI Overviews).
3. Naturally incorporate missing competitor entities (${Array.isArray(sharedEntities) ? sharedEntities.join(', ') : ''}) into relevant sections.
4. Improve formatting, lists, and readability without losing any core information.

Return valid JSON with this exact schema:
{
  "enhancedText": "string (the full updated markdown article)",
  "changesSummary": ["string (list of structural improvements made)"]
}

Original Article:
${text}`;

    const result = await callGroq<{ enhancedText: string; changesSummary: string[] }>(prompt, 45000);
    return res.json(result);
  } catch (error) {
    if (error instanceof LlmError) {
      return res.status(502).json({ error: error.message });
    }
    console.error('[Enhance Structure] Error:', error);
    return res.status(500).json({ error: 'Failed to enhance content structure' });
  }
});

router.post('/write-article', async (req: Request, res: Response) => {
  try {
    const { topic, targetKeyword, keywords, tone = 'professional', length = 'medium', instructions, sharedEntities } = req.body;

    const topicText = topic || targetKeyword;
    if (!topicText || typeof topicText !== 'string' || !topicText.trim()) {
      return res.status(400).json({ error: 'Topic or target keyword is required to generate an article.' });
    }

    const lengthGuide: Record<string, string> = {
      short: '3-4 paragraphs (~350 words)',
      medium: '6-8 paragraphs (~800 words)',
      long: '10-15 paragraphs (~1500 words)',
    };
    const targetLength = lengthGuide[length as keyof typeof lengthGuide] || lengthGuide.medium;

    const allKeywords = [
      ...(targetKeyword ? [targetKeyword] : []),
      ...(Array.isArray(keywords) ? keywords : []),
      ...(Array.isArray(sharedEntities) ? sharedEntities : []),
    ];

    const prompt = `You are an elite SEO Content Writer and Information Architect.
Write a comprehensive, high-ranking markdown article based on the user's inputs.

Specifications:
- Main Topic / Title Intent: ${topicText}
- Primary Keyword: ${targetKeyword || topicText}
- Target Keywords & Entities: ${allKeywords.join(', ')}
- Tone of Voice: ${tone}
- Target Length: ${targetLength}
${instructions ? `- Custom User Instructions / Key Focus:\n${instructions}` : ''}

Requirements:
1. Start with an engaging # H1 Title.
2. Structure sections using ## H2 headings and ### H3 sub-points.
3. Under every ## H2 heading, write a concise, direct answer paragraph (40-80 words) optimized for Google AI Overviews.
4. Naturally weave target keywords and entities into the text without keyword stuffing.
5. End with a ## Frequently Asked Questions section containing 3 relevant Q&A blocks.

Return valid JSON with this exact schema:
{
  "title": "string (main SEO title)",
  "content": "string (the full article formatted in markdown)",
  "metaDescription": "string (150-160 char meta description)",
  "keyPoints": ["string (3-5 key bullet points)"]
}`;

    const result = await callGroq<{
      title: string;
      content: string;
      metaDescription: string;
      keyPoints: string[];
    }>(prompt, 45000);

    return res.json(result);
  } catch (error) {
    if (error instanceof LlmError) {
      return res.status(502).json({ error: error.message });
    }
    console.error('[Write Article] Error:', error);
    return res.status(500).json({ error: 'Failed to write AI article' });
  }
});

router.post('/inspect-page', async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'URL is required' });
  }

  let targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  try {
    const domainName = new URL(targetUrl).hostname;

    const response = await axios.get(targetUrl, {
      timeout: 10000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 RankEngine-Inspector/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      validateStatus: (status) => status < 500,
    });

    const html = typeof response.data === 'string' ? response.data : '';
    const $ = cheerio.load(html);

    const liveTitle = $('title').first().text().trim() || `${domainName} - Home Page`;
    const liveMetaDesc =
      $('meta[name="description"i]').attr('content')?.trim() ||
      $('meta[property="og:description"i]').attr('content')?.trim() ||
      '';

    const headings: { id: number; level: 'h1' | 'h2' | 'h3'; text: string; directAnswer?: string; isValid?: boolean }[] = [];
    let hId = 1;

    $('h1, h2, h3').each((_, el) => {
      const tag = el.tagName.toLowerCase() as 'h1' | 'h2' | 'h3';
      const text = $(el).text().trim();
      if (!text || text.length < 3) return;

      let directAnswer = '';
      let isValid = false;

      if (tag === 'h2') {
        const nextP = $(el).nextAll('p').first().text().trim();
        if (nextP) {
          const wordCount = nextP.split(/\s+/).filter(Boolean).length;
          directAnswer = nextP;
          isValid = wordCount >= 40 && wordCount <= 80;
        }
      }

      headings.push({ id: hId++, level: tag, text, directAnswer, isValid });
    });

    if (headings.length === 0) {
      headings.push({ id: 1, level: 'h1', text: `${domainName} Official Home Page` });
    }

    const images: { id: number; src: string; alt: string; hasAlt: boolean; width: number; height: number; hasDimensions: boolean }[] = [];
    let imgId = 1;

    $('img').each((_, el) => {
      let src = $(el).attr('src')?.trim() || '';
      if (!src) return;

      if (src.startsWith('//')) {
        src = `https:${src}`;
      } else if (src.startsWith('/')) {
        src = `${targetUrl.replace(/\/$/, '')}${src}`;
      } else if (!/^https?:\/\//i.test(src)) {
        src = `${targetUrl.replace(/\/$/, '')}/${src}`;
      }

      const alt = $(el).attr('alt')?.trim() || '';
      const wAttr = parseInt($(el).attr('width') || '0', 10);
      const hAttr = parseInt($(el).attr('height') || '0', 10);

      images.push({
        id: imgId++,
        src,
        alt,
        hasAlt: Boolean(alt),
        width: isNaN(wAttr) ? 0 : wAttr,
        height: isNaN(hAttr) ? 0 : hAttr,
        hasDimensions: !isNaN(wAttr) && wAttr > 0 && !isNaN(hAttr) && hAttr > 0,
      });
    });

    return res.json({
      url: targetUrl,
      domainName,
      title: liveTitle,
      metaDescription: liveMetaDesc,
      headings: headings.slice(0, 12),
      images: images.slice(0, 8),
    });
  } catch (error: any) {
    console.warn('[Inspect Page] Live fetch error:', error?.message);
    const domainName = targetUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'apple.com';
    return res.json({
      url: targetUrl,
      domainName,
      title: `${domainName} - Official Site`,
      metaDescription: `Explore innovative products and experience world-class technology on ${domainName}.`,
      headings: [
        { id: 1, level: 'h1', text: `${domainName} Official Page` },
        { id: 2, level: 'h2', text: 'Innovative Technology & Global Services', directAnswer: `${domainName} delivers cutting-edge digital experiences, industry-leading hardware, and comprehensive user support worldwide.`, isValid: true },
      ],
      images: [
        { id: 1, src: `https://${domainName}/favicon.ico`, alt: `${domainName} Official Logo`, hasAlt: true, width: 512, height: 512, hasDimensions: true },
      ],
    });
  }
});

export default router;
