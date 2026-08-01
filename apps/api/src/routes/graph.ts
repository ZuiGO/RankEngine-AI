import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Project } from '../models/Project';
import { getProjectGraph, syncProjectGraph } from '../services/graphService';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

/**
 * GET /api/projects/:id/graph
 * Returns the Neo4j graph nodes and edges representing page & content relationships.
 */
router.get('/:id/graph', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const graph = await getProjectGraph(id);
    return res.json({ graph });
  } catch (error) {
    console.error('[GraphRoute] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch graph data' });
  }
});

/**
 * POST /api/projects/:id/graph/sync
 * Forces a re-sync of the Neo4j graph representation from MongoDB data.
 */
router.post('/:id/graph/sync', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const graph = await syncProjectGraph(id);
    return res.json({ graph });
  } catch (error) {
    console.error('[GraphRoute] Sync Error:', error);
    return res.status(500).json({ error: 'Failed to sync graph data' });
  }
});

export default router;
