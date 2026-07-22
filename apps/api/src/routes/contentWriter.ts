import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Project } from '../models/Project';
import { callGroq, LlmError } from '../services/llmService';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

const generateSchema = z.object({
  topic: z.string().min(1).max(2000),
  keywords: z.array(z.string().max(200)).max(50).optional(),
  tone: z.enum(['professional', 'conversational', 'persuasive', 'informative']).default('professional'),
  length: z.enum(['short', 'medium', 'long']).default('medium'),
  outline: z.string().max(5000).optional(),
});

const improveSchema = z.object({
  content: z.string().min(1).max(50000),
  instructions: z.string().max(2000).optional(),
});

router.post('/:id/content-writer/generate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const validation = generateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten().fieldErrors });
    }

    const { topic, keywords, tone, length, outline } = validation.data;

    const lengthGuide = { short: '2-3 paragraphs (~300 words)', medium: '4-6 paragraphs (~800 words)', long: '8-12 paragraphs (~1500 words)' };

    const prompt = `You are an expert SEO content writer. Generate a high-quality article based on the following specifications.

Return valid JSON with this exact schema:
{
  "title": "string (SEO-optimized headline)",
  "content": "string (the full article in markdown format)",
  "metaDescription": "string (150-160 char meta description)",
  "keyPoints": ["string (3-5 bullet points summarizing the article)"]
}

Topic: ${topic}
${keywords ? `Target keywords: ${keywords.join(', ')}` : ''}
Tone: ${tone}
Target length: ${lengthGuide[length]}
Domain context: ${project.domain}
${outline ? `Desired outline:\n${outline}` : ''}

Requirements:
- Write for ${project.domain} audience
- Naturally incorporate keywords into headings and body
- Use clear headings (H2, H3) for structure
- Include a compelling introduction and conclusion
- Focus on providing genuine value, not keyword stuffing
- Match the "${tone}" tone throughout`;

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
    console.error('[ContentWriter] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/content-writer/improve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const validation = improveSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten().fieldErrors });
    }

    const { content, instructions } = validation.data;

    const prompt = `You are an expert SEO content editor. Improve the following article based on the instructions.

Return valid JSON with this exact schema:
{
  "title": "string (improved or original headline)",
  "content": "string (the improved article in markdown format)",
  "changes": ["string (list of key changes made)"],
  "metaDescription": "string (improved meta description)"
}

Original content:
${content}

${instructions ? `Improvement instructions: ${instructions}` : 'Improve the content for clarity, SEO optimization, and engagement while preserving the original message.'}

Domain context: ${project.domain}

Requirements:
- Keep the same general topic and message
- Improve readability and flow
- Optimize for SEO without keyword stuffing
- Fix any grammar or style issues
- Match the original tone`;

    const result = await callGroq<{
      title: string;
      content: string;
      changes: string[];
      metaDescription: string;
    }>(prompt, 45000);

    return res.json(result);
  } catch (error) {
    if (error instanceof LlmError) {
      return res.status(502).json({ error: error.message });
    }
    console.error('[ContentWriter] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
