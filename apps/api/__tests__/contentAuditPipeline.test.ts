import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app';
import { Project } from '../src/models/Project';
import { CrawlJob } from '../src/models/CrawlJob';
import { AuditIssue } from '../src/models/AuditIssue';
import { PendingChange } from '../src/models/PendingChange';
import { generateSiteReport } from '../src/services/siteReportService';
import { getActionItems } from '../src/services/actionItemsService';

describe('Phase 2: Multi-Content Inventory & Action Items Integration Pipeline', () => {
  let projectId: string;
  let crawlJobId: string;

  beforeAll(async () => {
    // Connect to in-memory/test MongoDB if not already connected
    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/rankengine_test';
      await mongoose.connect(mongoUri);
    }
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  });

  beforeEach(async () => {
    await Project.deleteMany({});
    await CrawlJob.deleteMany({});
    await AuditIssue.deleteMany({});
    await PendingChange.deleteMany({});

    // Create a test project
    const proj = await Project.create({
      name: 'Content Audit Test Site',
      domain: 'https://content-test.com',
    });
    projectId = proj._id.toString();

    // Create a raw results document in crawlresults collection
    const crawlResultId = new mongoose.Types.ObjectId();
    await mongoose.connection.db!.collection('crawlresults').insertOne({
      _id: crawlResultId,
      crawlJobId: new mongoose.Types.ObjectId(),
      pages: [
        {
          url: 'https://content-test.com/page-1',
          internalLinkCount: 5,
          externalLinkCount: 2,
          contentInventory: {
            imageCount: 3,
            videoCount: 1,
            documentCount: 2,
            documents: [
              { url: 'https://content-test.com/doc.pdf', type: 'pdf' },
              { url: 'https://content-test.com/sheet.xlsx', type: 'xlsx' },
            ],
          },
        },
      ],
      createdAt: new Date(),
    });

    // Create a completed CrawlJob
    const job = await CrawlJob.create({
      projectId: proj._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 1,
      rawResultsRef: crawlResultId.toString(),
      completedAt: new Date(),
    });
    crawlJobId = job._id.toString();

    // Create content-type specific audit issues
    await AuditIssue.create([
      {
        crawlJobId: job._id,
        url: 'https://content-test.com/page-1',
        category: 'video-transcript',
        severity: 'warning',
        description: 'Video missing transcript or captions (youtube video: dQw4w9WgXcQ).',
        whyItMatters: 'Search engines cannot process audio streams without written transcripts.',
        recommendation: 'Add WebVTT closed captions or transcript text.',
      },
      {
        crawlJobId: job._id,
        url: 'https://content-test.com/doc.pdf',
        category: 'pdf-metadata',
        severity: 'warning',
        description: 'PDF document missing Title metadata property.',
        whyItMatters: 'Title metadata is displayed in Google search result snippets.',
        recommendation: 'Set descriptive Title document property for the PDF.',
      },
      {
        crawlJobId: job._id,
        url: 'https://content-test.com/page-1',
        category: 'image-alt',
        severity: 'warning',
        description: '2 image(s) missing alt text attribute.',
        whyItMatters: 'Alt text is required for image search indexing and accessibility.',
        recommendation: 'Add descriptive alt text attributes to images.',
      },
    ]);
  });

  it('1. generateSiteReport aggregates content inventory summary counts & content issues', async () => {
    const report = await generateSiteReport(projectId);

    expect(report.projectId).toBe(projectId);
    expect(report.counts.pageCount).toBe(1);
    expect(report.counts.pdfCount).toBe(1);
    expect(report.counts.videoCount).toBe(1);
    expect(report.counts.imageCount).toBe(3);
    expect(report.counts.documentCount).toBe(2);

    expect(report.pages.length).toBeGreaterThan(0);
    const mainPage = report.pages.find((p) => p.url === 'https://content-test.com/page-1');
    expect(mainPage).toBeDefined();
    expect(mainPage!.issues.some((i) => i.category === 'video-transcript')).toBe(true);
    expect(mainPage!.issues.some((i) => i.category === 'image-alt')).toBe(true);
  });

  it('2. getActionItems reshapes content audit issues into ActionItem pipeline objects', async () => {
    const actionItems = await getActionItems(projectId);

    expect(actionItems.length).toBe(3);
    const videoItem = actionItems.find((item) => item.identifiedIssues.includes('video-transcript'));
    expect(videoItem).toBeDefined();
    expect(videoItem!.pageUrl).toBe('https://content-test.com/page-1');
    expect(videoItem!.impactOnRanking).toBe('Search engines cannot process audio streams without written transcripts.');
    expect(videoItem!.howToImprove).toBe('Add WebVTT closed captions or transcript text.');
    expect(videoItem!.status).toBe('open');
  });

  it('3. GET /api/projects/:id/report endpoint returns consolidated report + content action items', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/report`)
      .expect(200);

    expect(res.body).toHaveProperty('report');
    expect(res.body).toHaveProperty('actionItems');
    expect(res.body.report.counts.pdfCount).toBe(1);
    expect(res.body.actionItems.length).toBe(3);
  });

  it('4. Approving a content action item updates its status in the pipeline', async () => {
    const actionItems = await getActionItems(projectId);
    const targetItem = actionItems[0];

    // Approve the content action item via pending-changes endpoint
    const approveRes = await request(app)
      .post(`/api/projects/${projectId}/pending-changes/${targetItem.contentId}/approve`)
      .expect(200);

    expect(approveRes.body.success).toBe(true);

    // Verify updated status in action items endpoint
    const updatedItems = await getActionItems(projectId);
    const approvedItem = updatedItems.find((item) => item.contentId === targetItem.contentId);
    expect(approvedItem).toBeDefined();
    expect(approvedItem!.status).toBe('approved');
  });
});
