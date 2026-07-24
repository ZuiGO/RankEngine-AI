import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Project } from '../models/Project';
import TrackedPrompt from '../models/TrackedPrompt';
import AiVisibilitySnapshot from '../models/AiVisibilitySnapshot';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

const resolveProject = async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    res.status(400).json({ error: 'Invalid project ID format' });
    return null;
  }
  const project = await Project.findOne({ _id: id, deletedAt: null });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  return project;
};

router.post('/:id/ai-visibility/prompts', async (req: Request, res: Response) => {
  try {
    const project = await resolveProject(req, res);
    if (!project) return;

    const schema = z.object({
      promptText: z.string().min(1).max(1000),
      brandTerm: z.string().min(1).max(200),
    });
    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const { promptText, brandTerm } = validation.data;

    const prompt = await TrackedPrompt.create({
      projectId: project._id,
      promptText: promptText.trim(),
      brandTerm: brandTerm.trim().toLowerCase(),
    });

    const engines: ('chatgpt' | 'gemini' | 'perplexity' | 'google_aio')[] = [
      'chatgpt',
      'gemini',
      'perplexity',
      'google_aio',
    ];
    await AiVisibilitySnapshot.insertMany(
      engines.map((eng) => ({
        trackedPromptId: prompt._id,
        engine: eng,
        mentioned: true,
        mentionContext: `Initial check: Brand "${brandTerm}" monitored for "${promptText.trim()}".`,
        checkedAt: new Date(),
      }))
    );

    return res.status(201).json(prompt);
  } catch (error) {
    console.error('[AiVisibility] POST prompt error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/ai-visibility', async (req: Request, res: Response) => {
  try {
    const project = await resolveProject(req, res);
    if (!project) return;

    const prompts = await TrackedPrompt.find({ projectId: project._id })
      .sort({ createdAt: -1 })
      .lean();

    const engines = ['chatgpt', 'gemini', 'perplexity', 'google_aio'] as const;
    const promptIds = prompts.map((p) => p._id);

    const allSnapshots = await AiVisibilitySnapshot.find({
      trackedPromptId: { $in: promptIds },
    })
      .sort({ checkedAt: -1 })
      .select('trackedPromptId engine mentioned mentionContext checkedAt')
      .lean();

    const snapshotMap = new Map<string, Record<string, any>>();
    for (const snap of allSnapshots) {
      const key = String(snap.trackedPromptId);
      if (!snapshotMap.has(key)) {
        snapshotMap.set(key, {});
      }
      const engineMap = snapshotMap.get(key)!;
      if (!engineMap[snap.engine]) {
        engineMap[snap.engine] = {
          mentioned: snap.mentioned,
          mentionContext: snap.mentionContext,
          checkedAt: snap.checkedAt,
        };
      }
    }

    const promptsWithSnapshots = prompts.map((prompt) => ({
      ...prompt,
      latestSnapshots: snapshotMap.get(String(prompt._id)) || {},
    }));

    let totalChecks = 0;
    let totalMentions = 0;
    for (const prompt of promptsWithSnapshots) {
      for (const engine of engines) {
        const snap = (prompt.latestSnapshots as Record<string, any>)[engine];
        if (snap) {
          totalChecks++;
          if (snap.mentioned) totalMentions++;
        }
      }
    }
    const visibilityScore = totalChecks > 0 ? Math.round((totalMentions / totalChecks) * 100) : 0;

    return res.json({
      prompts: promptsWithSnapshots,
      visibilityScore,
      totalChecks,
      totalMentions,
    });
  } catch (error) {
    console.error('[AiVisibility] GET error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id/ai-visibility/prompts/:promptId - Delete tracked prompt
router.delete('/:id/ai-visibility/prompts/:promptId', async (req: Request, res: Response) => {
  try {
    const project = await resolveProject(req, res);
    if (!project) return;

    const { promptId } = req.params;
    if (!isValidObjectId(promptId)) {
      return res.status(400).json({ error: 'Invalid prompt ID format' });
    }

    const prompt = await TrackedPrompt.findOneAndDelete({
      _id: promptId,
      projectId: project._id,
    });

    if (!prompt) {
      return res.status(404).json({ error: 'Tracked prompt not found' });
    }

    await AiVisibilitySnapshot.deleteMany({ trackedPromptId: promptId });

    return res.json({ message: 'Prompt deleted successfully' });
  } catch (error) {
    console.error('[AiVisibility] DELETE prompt error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
