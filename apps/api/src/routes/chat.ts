import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Project } from '../models/Project';
import { callGroq, LlmError } from '../services/llmService';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

const messageSchema = z.object({
  message: z.string().min(1).max(4000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).max(50).optional(),
});

router.post('/:id/chat', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const validation = messageSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten().fieldErrors });
    }

    const { message, history } = validation.data;

    const systemPrompt = `You are RankBot, an expert SEO assistant integrated into RankEngine AI. You help users with:

1. SEO strategy and best practices
2. Technical SEO (crawlability, indexing, Core Web Vitals)
3. Content optimization and keyword research
4. Site architecture and internal linking
5. Competitor analysis and gap analysis
6. Understanding SEO metrics and KPIs
7. Google algorithm updates

Current project domain: ${project.domain}
Project name: ${project.name}

Rules:
- Be concise and practical
- Provide actionable advice backed by SEO best practices
- Reference the project's domain when relevant
- If asked about something outside your scope, politely redirect
- Use markdown formatting for clarity (bold, lists, code blocks)
- When suggesting technical changes, be specific about implementation`;

    const conversation = [
      { role: 'system', content: systemPrompt },
      ...(history || []).map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user', content: message },
    ];

    const messages = conversation.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

    const prompt = `You are RankBot, an expert SEO assistant. Respond to the user's message in the context of the project domain: ${project.domain}.

${messages}

Return valid JSON with this exact schema:
{
  "reply": "string (your markdown-formatted response to the user)",
  "suggestedFollowUps": ["string (2-3 suggested follow-up questions the user might want to ask)"]
}`;

    const result = await callGroq<{
      reply: string;
      suggestedFollowUps: string[];
    }>(prompt, 30000);

    return res.json(result);
  } catch (error) {
    if (error instanceof LlmError) {
      return res.status(502).json({ error: error.message });
    }
    console.error('[Chat] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
