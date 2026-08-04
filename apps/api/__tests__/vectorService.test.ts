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

// Mock axios so Qdrant upsert calls are intercepted — tested via mock assertions
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

import { Project } from '../src/models/Project';
import { CrawlJob } from '../src/models/CrawlJob';
import { PageContent } from '../src/models/PageContent';
import { AuditIssue } from '../src/models/AuditIssue';
import {
  generateEmbedding,
  cosineSimilarity,
  chunkText,
  indexProjectContent,
  searchProjectContent,
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

  // Default axios mocks: Qdrant collection ensure returns 200, upsert returns 200
  mockedAxios.put = jest.fn().mockResolvedValue({ status: 200, data: { result: true } });
  mockedAxios.post = jest.fn().mockResolvedValue({ status: 200, data: {} });
  mockedAxios.get = jest.fn().mockResolvedValue({ status: 200, data: {} });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedAxios.put = jest.fn().mockResolvedValue({ status: 200, data: { result: true } });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Chunking quality + upsert metadata correctness
// ─────────────────────────────────────────────────────────────────────────────

describe('Test 1: indexProjectContent chunks text correctly and calls upsert with correct metadata', () => {
  it('produces expected chunk count for a known-length input and passes correct metadata to Qdrant', async () => {
    const project = await Project.create({
      name: 'Chunk Test Site',
      domain: 'chunktest.com',
      baseUrl: 'https://chunktest.com',
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 1,
    });

    // Build a text of exactly 450 words — should produce 3 chunks:
    // chunk 0: words 0–199 (200 words), chunk 1: words 160–359 (200 words), chunk 2: words 320–449 (130 words)
    const wordCount = 450;
    const longText = Array.from({ length: wordCount }, (_, i) => `word${i}`).join(' ');

    await PageContent.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      pageUrl: 'https://chunktest.com/report',
      contentType: 'pdf',
      sourceUrl: 'https://chunktest.com/report.pdf',
      extractedText: longText,
      extractionStatus: 'success',
    });

    const totalIndexed = await indexProjectContent(project._id.toString());

    // Verify chunks were generated from 450-word text with size=200 overlap=40:
    // chunk 0: words 0–199, chunk 1: words 160–359, chunk 2: words 320–449 → 3 chunks
    const expectedChunks = chunkText(longText);
    expect(expectedChunks).toHaveLength(3);
    expect(expectedChunks[0].split(' ').length).toBe(200);
    expect(expectedChunks[1].split(' ').length).toBe(200);
    expect(expectedChunks[2].split(' ')).toHaveLength(130); // remaining words

    // Total indexed docs = 3 content chunks (no audit issues in this job)
    expect(totalIndexed).toBe(3);

    // Verify Qdrant upsert was called with correct metadata shape
    expect(mockedAxios.put).toHaveBeenCalledWith(
      expect.stringContaining('/collections/rankengine_vectors/points'),
      expect.objectContaining({
        points: expect.arrayContaining([
          expect.objectContaining({
            payload: expect.objectContaining({
              projectId: project._id.toString(),
              pageUrl: 'https://chunktest.com/report',
              contentType: 'pdf',
              chunkText: expect.any(String),
            }),
          }),
        ]),
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Per-project isolation (no cross-project leakage)
// ─────────────────────────────────────────────────────────────────────────────

describe('Test 2: searchProjectContent results are filtered to the correct projectId', () => {
  it('never returns another project\'s content in search results', async () => {
    const projectA = await Project.create({
      name: 'Project Alpha',
      domain: 'alpha.com',
      baseUrl: 'https://alpha.com',
    });

    const projectB = await Project.create({
      name: 'Project Beta',
      domain: 'beta.com',
      baseUrl: 'https://beta.com',
    });

    const jobA = await CrawlJob.create({
      projectId: projectA._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 1,
    });

    const jobB = await CrawlJob.create({
      projectId: projectB._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 1,
    });

    // Project A has content about "SEO audit findings"
    await PageContent.create({
      projectId: projectA._id,
      crawlJobId: jobA._id,
      pageUrl: 'https://alpha.com/seo',
      contentType: 'pdf',
      sourceUrl: 'https://alpha.com/seo-audit.pdf',
      extractedText: 'SEO audit findings for alpha site — missing meta descriptions and title tags.',
      extractionStatus: 'success',
    });

    // Project B has content about "recipe cooking" — completely different domain
    await PageContent.create({
      projectId: projectB._id,
      crawlJobId: jobB._id,
      pageUrl: 'https://beta.com/recipes',
      contentType: 'docx',
      sourceUrl: 'https://beta.com/recipes.docx',
      extractedText: 'Recipe collection: chocolate cake, pasta carbonara, and lemon tart instructions.',
      extractionStatus: 'success',
    });

    await indexProjectContent(projectA._id.toString());
    await indexProjectContent(projectB._id.toString());

    // Search Project A for SEO content — should only see alpha.com results
    const resultsA = await searchProjectContent(projectA._id.toString(), 'seo audit meta descriptions');
    expect(resultsA.length).toBeGreaterThan(0);
    resultsA.forEach((r) => {
      expect(r.pageUrl).toContain('alpha.com');
      expect(r.pageUrl).not.toContain('beta.com');
    });

    // Search Project B for recipe content — should only see beta.com results
    const resultsB = await searchProjectContent(projectB._id.toString(), 'chocolate cake recipe');
    expect(resultsB.length).toBeGreaterThan(0);
    resultsB.forEach((r) => {
      expect(r.pageUrl).toContain('beta.com');
      expect(r.pageUrl).not.toContain('alpha.com');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Upsert semantics (no unbounded accumulation on re-index)
// ─────────────────────────────────────────────────────────────────────────────

describe('Test 3: re-indexing the same content does not create unbounded duplication', () => {
  it('produces the same document count on first and second index run for identical data', async () => {
    const project = await Project.create({
      name: 'Upsert Test Site',
      domain: 'upserttest.com',
      baseUrl: 'https://upserttest.com',
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 1,
    });

    await AuditIssue.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      url: 'https://upserttest.com/contact',
      severity: 'warning',
      category: 'seo-title',
      description: 'Page missing H1 heading',
      recommendation: 'Add a descriptive H1 heading',
      whyItMatters: 'H1 is a primary on-page ranking signal',
    });

    await PageContent.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      pageUrl: 'https://upserttest.com/whitepaper',
      contentType: 'pdf',
      sourceUrl: 'https://upserttest.com/wp.pdf',
      extractedText: 'Whitepaper on search engine optimization best practices and technical site audits.',
      extractionStatus: 'success',
    });

    // First index run
    const firstCount = await indexProjectContent(project._id.toString());

    // Second index run with identical data
    const secondCount = await indexProjectContent(project._id.toString());

    // The in-memory store is replaced (not appended), so count must be identical
    expect(secondCount).toBe(firstCount);

    // Verify Qdrant received exactly 2 PUT calls (one per index run) — not cumulative inserts
    const qdrantPutCalls = (mockedAxios.put as jest.Mock).mock.calls.filter(
      ([url]) => String(url).includes('/collections/rankengine_vectors/points')
    );
    expect(qdrantPutCalls).toHaveLength(2); // one per indexProjectContent call
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Utility tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Utility — generateEmbedding and cosineSimilarity', () => {
  it('generates a normalized 384-dimensional vector embedding', () => {
    const embedding = generateEmbedding('Technical PDF specifications and model weight');
    expect(embedding).toHaveLength(384);
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    expect(magnitude).toBeCloseTo(1.0, 4);
  });

  it('scores semantically similar texts higher than unrelated texts', () => {
    const v1 = generateEmbedding('PDF technical specification sheet');
    const v2 = generateEmbedding('PDF technical specification table');
    const v3 = generateEmbedding('Unrelated recipe for baking chocolate cake');
    expect(cosineSimilarity(v1, v2)).toBeGreaterThan(cosineSimilarity(v1, v3));
  });
});
