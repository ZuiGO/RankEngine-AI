import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import path from 'path';
import { Project } from '../models/Project';
import { CrawlJob } from '../models/CrawlJob';
import { AuditIssue } from '../models/AuditIssue';
import { Report } from '../models/Report';
import {
  buildReportPayload,
  generateReportHtml,
  renderPdf,
  buildContentPerformanceHtml,
  buildComparisonHtml,
  ReportType,
} from '../services/pdfExportService';
import { saveFile, getFileStream, generateDownloadToken } from '../services/storageService';
import ContentPerformanceReportModel from '../models/ContentPerformanceReport';
import { computeReport } from '../services/contentPerformanceService';
import BeforeAfterComparisonReportModel from '../models/BeforeAfterComparisonReport';
import { computeComparisonReport } from '../services/comparisonReportService';

const router = Router();

// POST /api/projects/:id/reports/generate
router.post('/:id/reports/generate', async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

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
    const reportType: ReportType = req.body.type || 'audit';

    let html = '';

    if (reportType === 'content-performance') {
      const contentReport = await computeReport(crawlJobIdStr);
      html = buildContentPerformanceHtml(contentReport);
    } else if (reportType === 'before-after-comparison') {
      const compReport = await computeComparisonReport({
        projectId: project._id.toString(),
        oldUrl: req.body.oldUrl || project.domain,
        newUrl: req.body.newUrl || project.stagingDomain || project.domain,
        oldCrawlJobId: crawlJobIdStr,
        newCrawlJobId: req.body.newCrawlJobId || crawlJobIdStr,
        pathOverrides: req.body.pathOverrides,
      });
      html = buildComparisonHtml(compReport);
    } else {
      const issues = await AuditIssue.find({ crawlJobId: crawlJobIdStr });

      const criticalIssues = issues.filter((i) => i.severity === 'critical');
      const warningIssues = issues.filter((i) => i.severity === 'warning');
      const passedIssues = issues.filter((i) => i.severity === 'passed');

      const healthScore = crawlJob.healthScore ?? 0;

      const sections: any[] = [];

      sections.push({
        title: 'SEO Health Score',
        type: 'score_gauge',
        data: {
          score: healthScore,
          label: `out of 100 — ${criticalIssues.length} critical, ${warningIssues.length} warnings`,
        },
      });

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

      const payload = buildReportPayload(
        project._id.toString(),
        project.name,
        project.domain,
        sections
      );

      html = generateReportHtml(payload);
    }
    const pdfBuffer = await renderPdf(html);

    const filename = `report_${project._id}_${crawlJobIdStr}_${Date.now()}.pdf`;
    const filePath = saveFile(pdfBuffer, filename);

    const { token, expiresAt } = generateDownloadToken();

    const report = await Report.create({
      projectId: project._id,
      crawlJobId: crawlJobIdStr,
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

// GET /api/projects/:id/reports/:reportId/download
router.get('/:id/reports/:reportId/download', async (req: Request, res: Response) => {
  try {
    const { id, reportId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(reportId)) {
      return res.status(400).json({ error: 'Invalid ID format' });
    }

    const project = await Project.findById(id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const report = await Report.findById(reportId);
    if (!report || report.projectId.toString() !== id) {
      return res.status(404).json({ error: 'Report not found' });
    }

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

    try {
      const stream = getFileStream(report.filePath);
      const filename = path.basename(report.filePath);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', report.fileSize);

      stream.on('error', (streamErr) => {
        console.error('Report stream error:', streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream report file' });
        }
      });

      res.on('error', (resErr) => {
        console.error('Response stream error during report download:', resErr);
        stream.destroy();
      });

      stream.pipe(res);
    } catch (fileErr) {
      console.error('Report file not found on disk:', fileErr);
      if (!res.headersSent) {
        res.status(404).json({ error: 'Report file not found on disk' });
      }
    }
  } catch (error) {
    console.error('Report download error:', error);
    res.status(500).json({ error: 'Failed to download report' });
  }
});

// GET /api/projects/:id/reports — list reports
router.get('/:id/reports', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));
    const skip = (page - 1) * limit;

    const filter = { projectId: id };
    const [reports, total] = await Promise.all([
      Report.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('_id projectId crawlJobId fileSize createdAt tokenExpiresAt'),
      Report.countDocuments(filter),
    ]);

    res.json({ reports, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('List reports error:', error);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});
// POST /api/projects/:id/reports/content-performance/generate
router.post('/:id/reports/content-performance/generate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const requestedCrawlJobId: string | undefined = req.body.crawlJobId;
    let crawlJob;

    if (requestedCrawlJobId) {
      if (!mongoose.Types.ObjectId.isValid(requestedCrawlJobId)) {
        return res.status(400).json({ error: 'Invalid crawlJobId format' });
      }
      crawlJob = await CrawlJob.findOne({ _id: requestedCrawlJobId, projectId: id, status: 'completed' });
    } else {
      crawlJob = await CrawlJob.findOne({ projectId: id, status: 'completed' }).sort({ completedAt: -1 });
    }

    if (!crawlJob) {
      return res.status(404).json({ error: 'No completed crawl job found for this project' });
    }

    const report = await computeReport(crawlJob._id.toString());
    return res.status(200).json(report);
  } catch (error: any) {
    console.error('Content performance report generation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate content performance report' });
  }
});

// GET /api/projects/:id/reports/content-performance/:reportId
router.get('/:id/reports/content-performance/:reportId', async (req: Request, res: Response) => {
  try {
    const { id, reportId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(reportId)) {
      return res.status(400).json({ error: 'Invalid ID format' });
    }

    const doc = await ContentPerformanceReportModel.findOne({ _id: reportId, projectId: id }).lean();
    if (!doc) {
      return res.status(404).json({ error: 'Content performance report not found' });
    }

    const report = {
      reportId: doc._id.toString(),
      projectId: doc.projectId,
      crawlJobId: doc.crawlJobId,
      generatedAt: doc.generatedAt.toISOString(),
      siteUrl: doc.siteUrl,
      overallScore: doc.overallScore,
      pageCount: doc.pageCount,
      pages: doc.pages,
      summary: doc.summary,
      gaConnected: doc.gaConnected,
      gscConnected: doc.gscConnected,
    };

    return res.json(report);
  } catch (error: any) {
    console.error('Fetch content performance report error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
// POST /api/projects/:id/reports/comparison/generate
router.post('/:id/reports/comparison/generate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const oldUrl = req.body.oldUrl || (project as any).liveDomain || project.domain;
    const newUrl = req.body.newUrl || project.stagingDomain || project.domain;
    const { oldCrawlJobId, newCrawlJobId, pathOverrides } = req.body;

    const report = await computeComparisonReport({
      projectId: id,
      oldUrl,
      newUrl,
      oldCrawlJobId,
      newCrawlJobId,
      pathOverrides,
    });

    return res.status(200).json(report);
  } catch (error: any) {
    console.error('Comparison report generation error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate comparison report' });
  }
});

// GET /api/projects/:id/reports/comparison/:reportId
router.get('/:id/reports/comparison/:reportId', async (req: Request, res: Response) => {
  try {
    const { id, reportId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(reportId)) {
      return res.status(400).json({ error: 'Invalid ID format' });
    }

    const doc = await BeforeAfterComparisonReportModel.findOne({ _id: reportId, projectId: id }).lean();
    if (!doc) {
      return res.status(404).json({ error: 'Comparison report not found' });
    }

    const report = {
      reportId: doc._id.toString(),
      projectId: doc.projectId,
      generatedAt: doc.generatedAt.toISOString(),
      oldSiteUrl: doc.oldSiteUrl,
      newSiteUrl: doc.newSiteUrl,
      oldCrawlJobId: doc.oldCrawlJobId,
      newCrawlJobId: doc.newCrawlJobId,
      overallScoreBefore: doc.overallScoreBefore,
      overallScoreAfter: doc.overallScoreAfter,
      pagesImproved: doc.pagesImproved,
      pagesRegressed: doc.pagesRegressed,
      pagesUnchanged: doc.pagesUnchanged,
      pagesAdded: doc.pagesAdded,
      pagesRemoved: doc.pagesRemoved,
      pages: doc.pages,
      note: doc.note,
    };

    return res.json(report);
  } catch (error: any) {
    console.error('Fetch comparison report error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
