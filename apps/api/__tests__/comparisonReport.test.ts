import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

// Mock BullMQ to prevent tests from requiring live Redis
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

import app from '../src/app';
import Project from '../src/models/Project';
import CrawlJob from '../src/models/CrawlJob';
import BeforeAfterComparisonReportModel from '../src/models/BeforeAfterComparisonReport';

const request = supertest(app);
let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Project.deleteMany({});
  await CrawlJob.deleteMany({});
  await BeforeAfterComparisonReportModel.deleteMany({});
  jest.restoreAllMocks();
});

describe('Before/After Comparison Report API Integration Tests', () => {
  it('generates and retrieves BeforeAfterComparisonReport with old and new crawl jobs', async () => {
    const project = await Project.create({
      name: 'Migration Comparison Project',
      domain: 'https://live-site.com',
      stagingDomain: 'https://staging-site.com',
    });

    const db = mongoose.connection.db;
    if (!db) throw new Error('DB error');

    // Seed old crawl result
    const oldResult = await db.collection('crawlresults').insertOne({
      crawlJobId: new mongoose.Types.ObjectId(),
      pages: [
        {
          url: 'https://live-site.com/home',
          path: '/home',
          title: 'Old Live Homepage Title 32 Chars',
          metaDescription: 'Old live site description satisfying the standard 120-158 length rule requirement.',
          h1Text: ['Live Site Home'],
          h2Count: 1,
          wordCount: 350,
          readabilityScore: 55,
          imageCount: 3,
          imagesWithAlt: 1,
          imagesMissingAlt: 2,
          internalLinkCount: 1,
          externalLinkCount: 0,
          hasStructuredData: false,
          canonicalUrl: 'https://live-site.com/home',
          isIndexable: true,
        },
      ],
      createdAt: new Date(),
    });

    const oldCrawlJob = await CrawlJob.create({
      projectId: project._id,
      url: 'https://live-site.com',
      status: 'completed',
      pageCount: 1,
      rawResultsRef: oldResult.insertedId.toString(),
      completedAt: new Date(),
    });

    // Seed new crawl result
    const newResult = await db.collection('crawlresults').insertOne({
      crawlJobId: new mongoose.Types.ObjectId(),
      pages: [
        {
          url: 'https://staging-site.com/home',
          path: '/home',
          title: 'New Improved Homepage Title 35 Chars',
          metaDescription: 'New improved staging description satisfying the standard 120-158 length rule requirement.',
          h1Text: ['Staging Site Home'],
          h2Count: 3,
          wordCount: 750,
          readabilityScore: 75,
          imageCount: 3,
          imagesWithAlt: 3,
          imagesMissingAlt: 0,
          internalLinkCount: 5,
          externalLinkCount: 0,
          hasStructuredData: true,
          structuredDataTypes: ['WebSite'],
          canonicalUrl: 'https://staging-site.com/home',
          isIndexable: true,
        },
      ],
      createdAt: new Date(),
    });

    const newCrawlJob = await CrawlJob.create({
      projectId: project._id,
      url: 'https://staging-site.com',
      status: 'completed',
      pageCount: 1,
      rawResultsRef: newResult.insertedId.toString(),
      completedAt: new Date(),
    });

    // 1. Generate Comparison Report
    const genRes = await request
      .post(`/api/projects/${project._id}/reports/comparison/generate`)
      .send({
        oldUrl: 'https://live-site.com',
        newUrl: 'https://staging-site.com',
        oldCrawlJobId: oldCrawlJob._id.toString(),
        newCrawlJobId: newCrawlJob._id.toString(),
      });

    expect(genRes.status).toBe(200);
    expect(genRes.body).toHaveProperty('reportId');
    expect(genRes.body.projectId).toBe(project._id.toString());
    expect(genRes.body.pagesImproved).toBe(1);
    expect(genRes.body.pagesRegressed).toBe(0);
    expect(genRes.body.overallScoreAfter).toBeGreaterThan(genRes.body.overallScoreBefore);
    expect(genRes.body.note).toContain('This comparison is based on on-page and technical SEO signals');

    const reportId = genRes.body.reportId;

    // 2. Fetch Comparison Report
    const getRes = await request.get(
      `/api/projects/${project._id}/reports/comparison/${reportId}`
    );

    expect(getRes.status).toBe(200);
    expect(getRes.body.reportId).toBe(reportId);
    expect(getRes.body.oldSiteUrl).toBe('https://live-site.com');
    expect(getRes.body.newSiteUrl).toBe('https://staging-site.com');
    expect(getRes.body.pages).toHaveLength(1);
  });
});
