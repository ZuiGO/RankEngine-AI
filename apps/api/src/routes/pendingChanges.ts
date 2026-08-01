import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { PendingChange } from '../models/PendingChange';
import { AuditIssue } from '../models/AuditIssue';
import { PageContent } from '../models/PageContent';
import { CrawlJob } from '../models/CrawlJob';
import { verifyApprovedChanges } from '../services/previewVerificationService';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

/**
 * POST /api/pending-changes/verify
 * Runs pre-publish verification over approved changes for a project, verifying preview render health before applying.
 */
router.post('/pending-changes/verify', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.body;
    if (!projectId || !isValidObjectId(projectId)) {
      return res.status(400).json({ error: 'Valid projectId is required' });
    }

    const report = await verifyApprovedChanges(projectId);
    return res.json({ report });
  } catch (error: any) {
    console.error('Verify pending changes error:', error);
    return res.status(500).json({ error: error.message || 'Failed to verify pending changes' });
  }
});

/**
 * POST /api/pending-changes/:id/approve
 * Approves a PendingChange or creates a new approved PendingChange for an AuditIssue or PageContent contentId (:id).
 */
router.post('/pending-changes/:id/approve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid ID format' });
    }

    let pendingChange = await PendingChange.findOne({
      $or: [{ _id: id }, { sourceAuditIssueId: id }],
    });

    if (pendingChange) {
      pendingChange.status = 'approved';
      await pendingChange.save();
    } else {
      const issue = await AuditIssue.findById(id);
      const pageContent = await PageContent.findById(id);

      if (!issue && !pageContent) {
        return res.status(404).json({ error: 'Audit issue or content item not found' });
      }

      let projectId = req.body.projectId;
      if (issue) {
        const crawlJob = await CrawlJob.findById(issue.crawlJobId);
        projectId = crawlJob ? crawlJob.projectId : (projectId || issue.crawlJobId);
      } else if (pageContent) {
        projectId = pageContent.projectId;
      }

      pendingChange = await PendingChange.create({
        sourceAuditIssueId: new mongoose.Types.ObjectId(id),
        projectId,
        status: 'approved',
        proposedChange: issue
          ? (issue.recommendation || issue.description)
          : (pageContent ? `${pageContent.contentType} optimization for ${pageContent.sourceUrl}` : 'Content fix'),
      });
    }

    return res.json({ success: true, pendingChange });
  } catch (error) {
    console.error('Approve pending change error:', error);
    return res.status(500).json({ error: 'Failed to approve change' });
  }
});

/**
 * POST /api/pending-changes/:id/reject
 * Rejects a PendingChange (resets status back to open by removing the PendingChange).
 */
router.post('/pending-changes/:id/reject', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid ID format' });
    }

    await PendingChange.deleteOne({
      $or: [{ _id: id }, { sourceAuditIssueId: id }],
    });

    return res.json({ success: true, status: 'open' });
  } catch (error) {
    console.error('Reject pending change error:', error);
    return res.status(500).json({ error: 'Failed to reject change' });
  }
});

/**
 * POST /api/projects/:projectId/pending-changes/:id/approve
 */
router.post('/projects/:projectId/pending-changes/:id/approve', async (req: Request, res: Response) => {
  const { id, projectId } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  try {
    let pendingChange = await PendingChange.findOne({
      $or: [{ _id: id }, { sourceAuditIssueId: id }],
    });

    if (pendingChange) {
      pendingChange.status = 'approved';
      await pendingChange.save();
    } else {
      const issue = await AuditIssue.findById(id);
      if (!issue) {
        return res.status(404).json({ error: 'Audit issue not found' });
      }

      pendingChange = await PendingChange.create({
        sourceAuditIssueId: issue._id,
        projectId: new mongoose.Types.ObjectId(projectId),
        status: 'approved',
        proposedChange: issue.recommendation || issue.description,
      });
    }

    return res.json({ success: true, pendingChange });
  } catch (error) {
    console.error('Approve project pending change error:', error);
    return res.status(500).json({ error: 'Failed to approve change' });
  }
});

/**
 * POST /api/projects/:projectId/pending-changes/:id/reject
 */
router.post('/projects/:projectId/pending-changes/:id/reject', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: 'Invalid ID format' });
  }

  try {
    await PendingChange.deleteOne({
      $or: [{ _id: id }, { sourceAuditIssueId: id }],
    });

    return res.json({ success: true, status: 'open' });
  } catch (error) {
    console.error('Reject project pending change error:', error);
    return res.status(500).json({ error: 'Failed to reject change' });
  }
});

export default router;
