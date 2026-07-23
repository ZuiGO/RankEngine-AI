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
import ContentPerformanceReportModel from '../src/models/ContentPerformanceReport';
import * as googleAnalyticsService from '../src/services/googleAnalyticsService';
import * as searchConsoleService from '../src/services/searchConsoleService';

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
  await ContentPerformanceReportModel.deleteMany({});
  jest.restoreAllMocks();
});

describe('Content Performance Report Integration Tests', () => {
  it('generates and fetches ContentPerformanceReport for a project without Google integration', async () => {
    const project = await Project.create({
      name: 'Unconnected SEO Project',
      domain: 'https://example.com',
    });

    const db = mongoose.connection.db;
    if (!db) throw new Error('DB error');

    // Seed raw crawl result in crawlresults
    const rawResultInsert = await db.collection('crawlresults').insertOne({
      crawlJobId: new mongoose.Types.ObjectId(),
      pages: [
        {
          url: 'https://example.com/',
          path: '/',
          title: 'Example Home Page Title 30 Chars Long',
          metaDescription: 'A complete meta description that satisfies length rules and provides valuable info to search engines.',
          h1Text: ['Welcome to Example Site'],
          h2Count: 2,
          wordCount: 750,
          readabilityScore: 70,
          imageCount: 2,
          imagesWithAlt: 2,
          imagesMissingAlt: 0,
          internalLinkCount: 5,
          externalLinkCount: 1,
          hasStructuredData: true,
          structuredDataTypes: ['WebSite'],
          canonicalUrl: 'https://example.com/',
          isIndexable: true,
        },
      ],
      createdAt: new Date(),
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      url: 'https://example.com',
      status: 'completed',
      pageCount: 1,
      rawResultsRef: rawResultInsert.insertedId.toString(),
      completedAt: new Date(),
    });

    // 1. Generate Report
    const genRes = await request
      .post(`/api/projects/${project._id}/reports/content-performance/generate`)
      .send({ crawlJobId: crawlJob._id.toString() });

    expect(genRes.status).toBe(200);
    expect(genRes.body).toHaveProperty('reportId');
    expect(genRes.body.projectId).toBe(project._id.toString());
    expect(genRes.body.crawlJobId).toBe(crawlJob._id.toString());
    expect(genRes.body.gaConnected).toBe(false);
    expect(genRes.body.gscConnected).toBe(false);
    expect(genRes.body.pages).toHaveLength(1);
    expect(genRes.body.pages[0].analytics).toBeNull();
    expect(genRes.body.pages[0].searchConsole).toBeNull();
    expect(genRes.body.pages[0].seoScore).toBeGreaterThanOrEqual(90);

    const reportId = genRes.body.reportId;

    // 2. Fetch Report
    const getRes = await request.get(
      `/api/projects/${project._id}/reports/content-performance/${reportId}`
    );

    expect(getRes.status).toBe(200);
    expect(getRes.body.reportId).toBe(reportId);
    expect(getRes.body.siteUrl).toBe('https://example.com');
  });

  it('generates ContentPerformanceReport merging GA4 and GSC metrics when Google integration is connected', async () => {
    const project = await Project.create({
      name: 'Connected SEO Project',
      domain: 'https://connected.com',
      googleIntegration: {
        gaPropertyId: '123456789',
        gscSiteUrl: 'https://connected.com/',
        encryptedRefreshToken: 'iv:tag:cipherText',
        connectedAt: new Date(),
      },
    });

    const db = mongoose.connection.db;
    if (!db) throw new Error('DB error');

    const rawResultInsert = await db.collection('crawlresults').insertOne({
      crawlJobId: new mongoose.Types.ObjectId(),
      pages: [
        {
          url: 'https://connected.com/blog/article',
          path: '/blog/article',
          title: 'Connected Article Title Length 35 Chars',
          metaDescription: 'A valid meta description that satisfies length rules and provides detailed information.',
          h1Text: ['Connected Article'],
          h2Count: 3,
          wordCount: 800,
          readabilityScore: 80,
          imageCount: 4,
          imagesWithAlt: 4,
          imagesMissingAlt: 0,
          internalLinkCount: 6,
          externalLinkCount: 2,
          hasStructuredData: true,
          structuredDataTypes: ['Article'],
          canonicalUrl: 'https://connected.com/blog/article',
          isIndexable: true,
        },
      ],
      createdAt: new Date(),
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      url: 'https://connected.com',
      status: 'completed',
      pageCount: 1,
      rawResultsRef: rawResultInsert.insertedId.toString(),
      completedAt: new Date(),
    });

    // Mock Google services
    jest.spyOn(googleAnalyticsService, 'getPageMetrics').mockResolvedValue(
      new Map([
        [
          '/blog/article',
          {
            sessions: 500,
            engagementRate: 0.72,
            avgEngagementTimeSec: 65,
            conversions: 15,
          },
        ],
      ])
    );

    jest.spyOn(searchConsoleService, 'getPageMetrics').mockResolvedValue(
      new Map([
        [
          '/blog/article',
          {
            clicks: 1200,
            impressions: 15000,
            ctr: 0.08,
            avgPosition: 2.5,
          },
        ],
      ])
    );

    const genRes = await request
      .post(`/api/projects/${project._id}/reports/content-performance/generate`)
      .send({ crawlJobId: crawlJob._id.toString() });

    expect(genRes.status).toBe(200);
    expect(genRes.body.gaConnected).toBe(true);
    expect(genRes.body.gscConnected).toBe(true);

    const page = genRes.body.pages[0];
    expect(page.analytics).toEqual({
      sessions: 500,
      engagementRate: 0.72,
      avgEngagementTimeSec: 65,
      conversions: 15,
    });

    expect(page.searchConsole).toEqual({
      clicks: 1200,
      impressions: 15000,
      ctr: 0.08,
      avgPosition: 2.5,
    });
  });
});
