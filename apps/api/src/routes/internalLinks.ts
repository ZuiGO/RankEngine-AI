import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Project } from '../models/Project';
import { callGroq, LlmError } from '../services/llmService';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

const suggestSchema = z.object({
  pages: z.array(z.object({
    url: z.string().min(1).max(2000),
    title: z.string().max(500).optional(),
    headings: z.array(z.string().max(500)).max(50).optional(),
    contentSnippet: z.string().max(3000).optional(),
    wordCount: z.number().int().optional(),
  })).min(2).max(100),
  targetPages: z.array(z.string().min(1).max(2000)).max(20).optional(),
  maxSuggestions: z.number().int().min(1).max(50).default(20),
});

router.post('/:id/internal-links', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const validation = suggestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten().fieldErrors });
    }

    const { pages, targetPages, maxSuggestions } = validation.data;

    const pageList = pages.map((p, i) =>
      `[${i}] URL: ${p.url}${p.title ? ` | Title: ${p.title}` : ''}${p.headings ? ` | Headings: ${p.headings.join('; ').substring(0, 500)}` : ''}${p.contentSnippet ? ` | Snippet: ${p.contentSnippet.substring(0, 500)}` : ''}`
    ).join('\n');

    const targetList = targetPages ? targetPages.join('\n') : 'All pages above are eligible targets';

    const prompt = `You are an expert SEO architect specializing in internal linking strategy. Analyze the following pages and suggest internal links that improve site structure, distribute page authority, and enhance user navigation.

Return valid JSON with this exact schema:
{
  "suggestions": [
    {
      "sourceUrl": "string (the page where the link should be added)",
      "targetUrl": "string (the page to link to)",
      "anchorText": "string (suggested anchor text)",
      "reason": "string (brief explanation of why this link is beneficial)",
      "priority": "high | medium | low"
    }
  ]
}

Pages:
${pageList}

Eligible target pages:
${targetList}

Maximum suggestions: ${maxSuggestions}
Domain: ${project.domain}

Requirements:
- Prioritize linking deep/bottom-of-funnel pages from top-of-funnel pages
- Avoid linking pages that are already well-connected
- Prefer descriptive anchor text over generic "click here"
- Each source-target pair should appear at most once
- Consider semantic relevance between pages
- Assign priority: high (strong relevance + authority distribution), medium (good opportunity), low (nice to have)`;

    const result = await callGroq<{
      suggestions: Array<{
        sourceUrl: string;
        targetUrl: string;
        anchorText: string;
        reason: string;
        priority: 'high' | 'medium' | 'low';
      }>;
    }>(prompt, 60000);

    return res.json(result);
  } catch (error) {
    if (error instanceof LlmError) {
      return res.status(502).json({ error: error.message });
    }
    console.error('[InternalLinks] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
