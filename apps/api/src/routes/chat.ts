import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Project } from '../models/Project';
import { callGroq, LlmError } from '../services/llmService';
import { buildProjectContext } from '../services/chatContextService';
import { searchProjectContent, searchProjectVectors } from '../services/vectorService';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

const chatRequestSchema = z
  .object({
    question: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
    section: z.string().optional(),
    history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional(),
  })
  .transform((data) => ({
    question: (data.question ?? data.message ?? '').trim(),
    section: data.section,
    history: data.history,
  }))
  .refine((data) => data.question.length > 0, { message: 'question or message must be a non-empty string' });

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

    const { question, section, history } = validation.data;

    const baseContext = await buildProjectContext(id, section, question);

    if (baseContext === 'No audit data available yet for this project.') {
      return res.json({ answer: NO_DATA_RESPONSE });
    }

    const normSection = (section || 'Overview').toLowerCase().replace(/[\s_]+/g, '');

    // Execute real retrieval-augmented vector search ONLY for pages / content / all sections
    let vectorMatches: any[] = [];
    if (normSection === 'pages' || normSection === 'content' || normSection === 'all') {
      try {
        const searchFn = typeof searchProjectContent === 'function' ? searchProjectContent : searchProjectVectors;
        vectorMatches = await searchFn(id, question, section, 5);
      } catch (e) {
        vectorMatches = [];
      }
    }

    const safeVectorMatches = Array.isArray(vectorMatches) ? vectorMatches : [];
    const vectorContextText = safeVectorMatches.length > 0
      ? `Top Vector Search Matches (Section: ${section || 'Overview'}):\n` +
        safeVectorMatches.map((m) => `- [Page: ${m.pageUrl} | Section: ${m.section} | Type: ${m.contentType}]: ${m.chunkText}`).join('\n')
      : '';

    const combinedContext = safeVectorMatches.length > 0
      ? `${baseContext}\n\n${vectorContextText}`
      : baseContext;

    const scopingInstruction = `You are an expert SEO assistant integrated into RankEngine AI. You are responding within the "${section || 'Overview'}" section context.\n\nProject Data & Vector Search Results:\n${combinedContext}\n\nIMPORTANT: This product has NO Google Analytics or Search Console integration. It does NOT know a project's real traffic numbers. Do not answer a traffic question with a fabricated or guessed cause. If asked about traffic, say that RankEngine doesn't have traffic data, then state what data it DOES have access to (audit findings, rank positions, competitor movement, AI visibility).\n\nWhen providing answers based on retrieved content, cite the source page URL in your answer or response.`;

    const conversationParts = [
      { role: 'system', content: scopingInstruction },
      ...(history || []).map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: question },
    ];

    const prompt = conversationParts
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n') + `\n\nReturn valid JSON with this exact schema:\n{\n  "answer": "string (your response to the user)"\n}`;

    const result = await callGroq<{ answer: string }>(prompt, 30000);

    const responsePayload: any = { answer: result.answer };

    if (safeVectorMatches.length > 0) {
      // Source attribution: include unique pageUrls derived from retrieved vector chunks
      const uniquePageUrls = Array.from(new Set(safeVectorMatches.map((v) => v.pageUrl).filter(Boolean)));
      responsePayload.citations = uniquePageUrls;
      responsePayload.vectorMatches = safeVectorMatches.map((v) => ({
        section: v.section,
        pageUrl: v.pageUrl,
        contentType: v.contentType,
        score: v.score,
        chunkText: v.chunkText,
      }));
    }

    return res.json(responsePayload);
  } catch (error) {
    if (error instanceof LlmError) {
      return res.status(502).json({ error: error.message });
    }
    console.error('[Chat] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

