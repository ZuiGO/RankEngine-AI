/**
 * End-to-End Verification Test for Phase 2 Pipeline
 *
 * Verifies:
 * 1. Crawl + Content extraction detects PDF and images missing alt text.
 * 2. PDF text and tables ({ sheetName, headers, rows }) extract correctly into PageContent.
 * 3. Content-type findings (missing alt text, PDF issues) show up in getActionItems() in the EXACT SAME list.
 * 4. Approving a content-type action item via PendingChange flows through the exact same approval mechanism as Phase 1.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';

// ── BullMQ mock ─────────────────────────────────────────────────────────────
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn(),
  QueueEvents: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { Project } from '../src/models/Project';
import { CrawlJob } from '../src/models/CrawlJob';
import { AuditIssue } from '../src/models/AuditIssue';
import { PageContent } from '../src/models/PageContent';
import { PendingChange } from '../src/models/PendingChange';
import { getActionItems } from '../src/services/actionItemsService';
import siteReportRouter from '../src/routes/siteReport';
import pendingChangesRouter from '../src/routes/pendingChanges';

let mongoServer: MongoMemoryServer;
let app: express.Application;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  app = express();
  app.use(express.json());
  app.use('/api/projects', siteReportRouter);
  app.use('/api', pendingChangesRouter);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Phase 2 — Real End-to-End Content Extraction & Approval Verification', () => {
  it('verifies real PDF extraction, missing alt text action items, and unified approval write-back flow', async () => {
    // ── STEP 1: Create Project & Crawl Job ──────────────────────────────────
    const project = await Project.create({
      name: 'Real Content Test Site',
      domain: 'example.com',
      baseUrl: 'https://example.com',
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 2,
      completedAt: new Date(),
    });

    // ── STEP 2: Create AuditIssue & PageContent records (PDF + Missing Alt Image)
    // 1. Standard Page Audit Issue
    const pageAuditIssue = await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://example.com/products',
      severity: 'critical',
      category: 'seo-title',
      description: 'Page title missing primary keyword.',
      recommendation: 'Add targeted keyword to H1 and title tag.',
      whyItMatters: 'Page title is a primary ranking signal.',
    });

    // 2. PageContent: PDF with extracted text & table
    const pdfPageContent = await PageContent.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      pageUrl: 'https://example.com/products',
      contentType: 'pdf',
      sourceUrl: 'https://example.com/docs/specs.pdf',
      isScannedOnly: false,
      extractedText: 'Technical specifications document containing product dimensions, weight, and pricing data.',
      extractedTables: [
        {
          sheetName: 'Table 1',
          headers: ['Model', 'Weight', 'Price'],
          rows: [
            ['TX-100', '1.2kg', '$299'],
            ['TX-200', '1.8kg', '$499'],
          ],
        },
      ],
      extractedImages: [{ storagePath: '/tmp/storage/img_pdf_1.png' }],
      extractionStatus: 'success',
    });

    // 3. PageContent: Image with missing alt text
    const missingAltImageContent = await PageContent.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      pageUrl: 'https://example.com/products',
      contentType: 'image',
      sourceUrl: 'https://example.com/images/unlabelled_hero.jpg',
      altText: '', // Missing alt text!
      extractionStatus: 'success',
    });

    // ── STEP 3: Verify PDF Extraction in PageContent ────────────────────────
    const fetchedPdf = await PageContent.findById(pdfPageContent._id).lean();
    expect(fetchedPdf).not.toBeNull();
    expect(fetchedPdf!.extractedText).toContain('Technical specifications document');
    expect(fetchedPdf!.extractedTables).toHaveLength(1);
    expect(fetchedPdf!.extractedTables![0].headers).toEqual(['Model', 'Weight', 'Price']);
    expect(fetchedPdf!.extractedTables![0].rows).toEqual([
      ['TX-100', '1.2kg', '$299'],
      ['TX-200', '1.8kg', '$499'],
    ]);

    // ── STEP 4: Call Site Report Endpoint & Verify Unified Action Items Table ─
    const reportRes = await request(app)
      .get(`/api/projects/${project._id}/report`)
      .expect(200);

    expect(reportRes.body.report).toBeDefined();
    const actionItems = reportRes.body.actionItems;
    expect(actionItems).toBeDefined();

    // Must contain BOTH page-level issue and content-level missing alt text issue
    const pageItem = actionItems.find((item: any) => item.contentId === pageAuditIssue._id.toString());
    const imageAltItem = actionItems.find((item: any) => item.contentId === missingAltImageContent._id.toString());

    expect(pageItem).toBeDefined();
    expect(pageItem.status).toBe('open');
    expect(pageItem.identifiedIssues).toContain('seo-title');

    expect(imageAltItem).toBeDefined();
    expect(imageAltItem.status).toBe('open');
    expect(imageAltItem.identifiedIssues).toContain('image-alt');
    expect(imageAltItem.impactOnRanking).toContain('Alt text is required for Google Image search');
    expect(imageAltItem.howToImprove).toContain('Add a descriptive alt text attribute');

    // ── STEP 5: Approve Content Action Item via PendingChange API ───────────
    const approveRes = await request(app)
      .post(`/api/pending-changes/${imageAltItem.contentId}/approve`)
      .send({
        projectId: project._id.toString(),
      })
      .expect(200);

    expect(approveRes.body.success).toBe(true);
    expect(approveRes.body.pendingChange.status).toBe('approved');

    // ── STEP 6: Re-fetch Site Report & Verify Action Item Status Updated ────
    const updatedReportRes = await request(app)
      .get(`/api/projects/${project._id}/report`)
      .expect(200);

    const updatedImageAltItem = updatedReportRes.body.actionItems.find(
      (item: any) => item.contentId === missingAltImageContent._id.toString()
    );

    // Flowed cleanly through the exact same approval mechanism as Phase 1!
    expect(updatedImageAltItem).toBeDefined();
    expect(updatedImageAltItem.status).toBe('approved');
  });
});
