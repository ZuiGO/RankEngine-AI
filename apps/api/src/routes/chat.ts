import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Project } from '../models/Project';
import { callGroq, LlmError } from '../services/llmService';
import { buildProjectContext } from '../services/chatContextService';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

const chatRequestSchema = z.object({
  question: z.string().min(1),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional(),
});

const NO_DATA_RESPONSE = "I don't have any audit data for this project yet — run an audit first so I have something to work with.";

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

    const validation = chatRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten().fieldErrors });
    }

    const { question, history } = validation.data;

    const context = await buildProjectContext(id);

    if (context === 'No audit data available yet for this project.') {
      return res.json({ answer: NO_DATA_RESPONSE });
    }

    const scopingInstruction = `You are an expert SEO assistant integrated into RankEngine AI. You have access to the following project data:\n\n${context}\n\nIMPORTANT: This product has NO Google Analytics or Search Console integration. It does NOT know a project's real traffic numbers. Do not answer a traffic question with a fabricated or guessed cause. If asked about traffic, say that RankEngine doesn't have traffic data, then state what data it DOES have access to (audit findings, rank positions, competitor movement, AI visibility).`;

    const conversationParts = [
      { role: 'system', content: scopingInstruction },
      ...(history || []).map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: question },
    ];

    const prompt = conversationParts
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n') + `\n\nReturn valid JSON with this exact schema:\n{\n  "answer": "string (your response to the user)"\n}`;

    const result = await callGroq<{ answer: string }>(prompt, 30000);

    return res.json({ answer: result.answer });
  } catch (error) {
    if (error instanceof LlmError) {
      return res.status(502).json({ error: error.message });
    }
    console.error('[Chat] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
