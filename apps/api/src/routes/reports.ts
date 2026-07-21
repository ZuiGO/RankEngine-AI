import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import path from 'path';
import { Project } from '../models/Project';
import { CrawlJob } from '../models/CrawlJob';
import { AuditIssue } from '../models/AuditIssue';
import { Report } from '../models/Report';
import { Organization } from '../models/Organization';
import { Membership } from '../models/Membership';
import requireAuth from '../middleware/requireAuth';
import { buildReportPayload, generateReportHtml, renderPdf } from '../services/pdfExportService';
import { saveFile, getFileStream, generateDownloadToken } from '../services/storageService';

const router = Router();
router.use(requireAuth);

// ── Auth helpers ───────────────────────────────────────────────────────

async function checkProjectAccess(
  projectId: string,
  userId: string
): Promise<{ project: any; membership: any } | null> {
  if (!mongoose.Types.ObjectId.isValid(projectId)) return null;

  const project = await Project.findById(projectId);
  if (!project) return null;

  const membership = await Membership.findOne({
    organizationId: project.organizationId,
    userId,
  });
  if (!membership) return null;

  return { project, membership };
}

// ── POST /api/projects/:id/reports/generate ────────────────────────────

router.post('/:id/reports/generate', async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const access = await checkProjectAccess(req.params.id, req.user.userId);
    if (!access) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const { project } = access;

    // Parse optional crawlJobId from body; default to most recent completed crawl
    const crawlJobId: string | undefined = req.body.crawlJobId;
    if (crawlJobId && !mongoose.Types.ObjectId.isValid(crawlJobId)) {
      return res.status(400).json({ error: 'Invalid crawlJobId format' });
    }

    let crawlJob;
    if (crawlJobId) {
      crawlJob = await CrawlJob.findById(crawlJobId);
      if (!crawlJob || crawlJob.projectId.toString() !== project._id.toString()) {
        return res.status(404).json({ error: 'Crawl job not found for this project' });
      }
    } else {
      crawlJob = await CrawlJob.findOne({
        projectId: project._id,
        status: 'completed',
      }).sort({ completedAt: -1 });
    }

    if (!crawlJob) {
      return res.status(400).json({ error: 'No completed crawl job found for this project' });
    }

    if (crawlJob.status !== 'completed') {
      return res.status(400).json({ error: 'Crawl job is not yet completed' });
    }

    const crawlJobIdStr = crawlJob._id.toString();

    // Fetch issues and build report data
    const issues = await AuditIssue.find({ crawlJobId: crawlJobIdStr });

    const criticalIssues = issues.filter((i) => i.severity === 'critical');
    const warningIssues = issues.filter((i) => i.severity === 'warning');
    const passedIssues = issues.filter((i) => i.severity === 'passed');

    const healthScore = crawlJob.healthScore ?? 0;

    // Build sections for the PDF report
    const sections: any[] = [];

    // 1. Health Score gauge
    sections.push({
      title: 'SEO Health Score',
      type: 'score_gauge',
      data: {
        score: healthScore,
        label: `out of 100 — ${criticalIssues.length} critical, ${warningIssues.length} warnings`,
      },
    });

    // 2. Issue counts stat grid
    sections.push({
      title: 'Issue Summary',
      type: 'table',
      data: {
        headers: ['Category', 'Count'],
        rows: [
          ['Critical Issues', String(criticalIssues.length)],
          ['Warnings', String(warningIssues.length)],
          ['Passed Checks', String(passedIssues.length)],
          ['Total Pages Crawled', String(crawlJob.pageCount)],
        ],
        colorMap: { Count: criticalIssues.length > 5 ? '#dc2626' : '#16a34a' },
      },
    });

    // 3. Top critical issues with recommendations (up to 15)
    const topCritical = criticalIssues.slice(0, 15);
    if (topCritical.length > 0) {
      sections.push({
        title: `Top Critical Issues (${topCritical.length} of ${criticalIssues.length})`,
        type: 'checklist',
        data: {
          items: topCritical.map((i) => ({
            severity: 'critical',
            description: `${i.description}${i.whyItMatters ? ` — ${i.whyItMatters}` : ''}`,
            recommendation: i.recommendation,
          })),
        },
      });
    }

    // 4. Top warnings with recommendations (up to 10)
    const topWarnings = warningIssues.slice(0, 10);
    if (topWarnings.length > 0) {
      sections.push({
        title: `Top Warnings (${topWarnings.length} of ${warningIssues.length})`,
        type: 'checklist',
        data: {
          items: topWarnings.map((i) => ({
            severity: 'warning',
            description: i.description,
            recommendation: i.recommendation,
          })),
        },
      });
    }

    // Fetch org branding for white-label report
    const org = await Organization.findById(project.organizationId).select(
      'name logoUrl primaryColor reportFooterText'
    );
    const whiteLabel =
      org?.logoUrl || org?.primaryColor || org?.reportFooterText
        ? {
            agencyName: org.name,
            agencyLogoUrl: org.logoUrl ?? undefined,
            primaryColor: org.primaryColor ?? undefined,
            reportFooterText: org.reportFooterText ?? undefined,
          }
        : undefined;

    // Build payload and render PDF
    const payload = buildReportPayload(
      project._id.toString(),
      project.name,
      project.domain,
      sections,
      whiteLabel
    );

    const html = generateReportHtml(payload);
    const pdfBuffer = await renderPdf(html);

    // Save to local storage
    const filename = `report_${project._id}_${crawlJobIdStr}_${Date.now()}.pdf`;
    const filePath = saveFile(pdfBuffer, filename);

    // Generate download token
    const { token, expiresAt } = generateDownloadToken();

    // Persist report metadata
    const report = await Report.create({
      projectId: project._id,
      crawlJobId: crawlJobIdStr,
      generatedBy: req.user.userId,
      filePath,
      fileSize: pdfBuffer.length,
      downloadToken: token,
      tokenExpiresAt: expiresAt,
    });

    res.status(201).json({
      message: 'Report generated successfully',
      report: {
        id: report._id,
        projectId: report.projectId,
        crawlJobId: report.crawlJobId,
        fileSize: report.fileSize,
        createdAt: report.createdAt,
        downloadUrl: `/api/projects/${project._id}/reports/${report._id}/download?token=${token}`,
      },
    });
  } catch (error) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// ── GET /api/projects/:id/reports/:reportId/download ───────────────────

router.get('/:id/reports/:reportId/download', async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const access = await checkProjectAccess(req.params.id, req.user.userId);
    if (!access) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { reportId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(reportId)) {
      return res.status(400).json({ error: 'Invalid report ID format' });
    }

    const report = await Report.findById(reportId);
    if (!report || report.projectId.toString() !== req.params.id) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Validate download token
    const token = String(req.query.token || '');
    if (!token) {
      return res.status(400).json({ error: 'Download token is required' });
    }

    if (report.downloadToken !== token) {
      return res.status(403).json({ error: 'Invalid download token' });
    }

    if (new Date() > report.tokenExpiresAt) {
      return res.status(410).json({ error: 'Download token has expired' });
    }

    // Stream the file
    try {
      const stream = getFileStream(report.filePath);
      const filename = path.basename(report.filePath);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', report.fileSize);

      stream.pipe(res);
    } catch (fileErr) {
      console.error('Report file not found on disk:', fileErr);
      res.status(404).json({ error: 'Report file not found on disk' });
    }
  } catch (error) {
    console.error('Report download error:', error);
    res.status(500).json({ error: 'Failed to download report' });
  }
});

// ── GET /api/projects/:id/reports — list reports ───────────────────────

router.get('/:id/reports', async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const access = await checkProjectAccess(req.params.id, req.user.userId);
    if (!access) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const reports = await Report.find({ projectId: req.params.id })
      .sort({ createdAt: -1 })
      .select('_id projectId crawlJobId fileSize createdAt tokenExpiresAt');

    res.json({ reports });
  } catch (error) {
    console.error('List reports error:', error);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

export default router;
