import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Project } from '../models/Project';
import { callGroq, LlmError } from '../services/llmService';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

const clusterSchema = z.object({
  keywords: z.array(z.string().min(1).max(200)).min(2).max(500),
  maxClusters: z.number().int().min(2).max(20).default(8),
});

router.post('/:id/keywords/cluster', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const validation = clusterSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten().fieldErrors });
    }

    const { keywords, maxClusters } = validation.data;

    const prompt = `You are an expert SEO keyword strategist. Group the following keywords into thematic clusters based on search intent, topic relevance, and user journey stage.

Return valid JSON with this exact schema:
{
  "clusters": [
    {
      "name": "string (descriptive cluster name, e.g. 'On-Page SEO')",
      "description": "string (brief explanation of what this cluster covers)",
      "keywords": ["string (keywords belonging to this cluster)"],
      "searchIntent": "informational | commercial | transactional | navigational",
      "relevance": number (0-100 score of how tightly grouped these keywords are)
    }
  ],
  "unassigned": ["string (keywords that didn't fit any cluster, empty array if all assigned)"]
}

Keywords: ${keywords.join(', ')}

Maximum number of clusters to create: ${maxClusters}
Domain: ${project.domain}

Requirements:
- Each keyword should appear in exactly one cluster
- Create ${Math.min(maxClusters, Math.ceil(keywords.length / 2))} to ${maxClusters} clusters
- Name clusters descriptively (e.g. not "Cluster 1")
- Assign a search intent to each cluster
- Provide 0-100 relevance score based on keyword similarity within the cluster
- Any keyword that truly cannot be grouped should go in unassigned (minimize this)`;

    const result = await callGroq<{
      clusters: Array<{
        name: string;
        description: string;
        keywords: string[];
        searchIntent: string;
        relevance: number;
      }>;
      unassigned: string[];
    }>(prompt, 60000);

    return res.json(result);
  } catch (error) {
    if (error instanceof LlmError) {
      return res.status(502).json({ error: error.message });
    }
    console.error('[KeywordClustering] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
