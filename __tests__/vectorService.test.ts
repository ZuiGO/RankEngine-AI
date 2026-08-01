import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

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
import { PageContent } from '../src/models/PageContent';
import { AuditIssue } from '../src/models/AuditIssue';
import {
  generateEmbedding,
  cosineSimilarity,
  indexProjectContent,
  searchProjectVectors,
} from '../src/services/vectorService';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Vector DB & Semantic Search Service Tests', () => {
  it('generates a normalized 384-dimensional vector embedding', () => {
    const embedding = generateEmbedding('Technical PDF specifications and model weight');
    expect(embedding).toHaveLength(384);
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    expect(magnitude).toBeCloseTo(1.0, 4);
  });

  it('computes correct cosine similarity between matching embeddings', () => {
    const v1 = generateEmbedding('PDF technical specification sheet');
    const v2 = generateEmbedding('PDF technical specification table');
    const v3 = generateEmbedding('Unrelated recipe for baking chocolate cake');

    const similaritySame = cosineSimilarity(v1, v2);
    const similarityDifferent = cosineSimilarity(v1, v3);

    expect(similaritySame).toBeGreaterThan(similarityDifferent);
  });

  it('indexes project content and searches semantically with section filtering', async () => {
    const project = await Project.create({
      name: 'Vector Search Test Site',
      domain: 'vectorsearch.com',
      baseUrl: 'https://vectorsearch.com',
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 2,
    });

    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://vectorsearch.com/pricing',
      severity: 'critical',
      category: 'seo-title',
      description: 'Pricing page title missing primary keyword',
      recommendation: 'Add SEO title to pricing page',
      whyItMatters: 'Title tags affect organic ranking',
    });

    await PageContent.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      pageUrl: 'https://vectorsearch.com/specs',
      contentType: 'pdf',
      sourceUrl: 'https://vectorsearch.com/docs/specs.pdf',
      extractedText: 'Technical specifications document containing dimensions, weight, and pricing data.',
      extractionStatus: 'success',
    });

    const indexedCount = await indexProjectContent(project._id.toString());
    expect(indexedCount).toBeGreaterThan(0);

    // Search for PDF technical specifications scoped to Content section
    const resultsContent = await searchProjectVectors(
      project._id.toString(),
      'technical specifications pdf',
      'Content'
    );

    expect(resultsContent.length).toBeGreaterThan(0);
    expect(resultsContent[0].section).toBe('Content');
    expect(resultsContent[0].text).toContain('Technical specifications');

    // Search for Action Items
    const resultsActionItems = await searchProjectVectors(
      project._id.toString(),
      'pricing title tag',
      'Action Items'
    );

    expect(resultsActionItems.length).toBeGreaterThan(0);
    expect(resultsActionItems[0].section).toBe('Action Items');
  });
});
