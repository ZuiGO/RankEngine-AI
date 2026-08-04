/**
 * Phase 3 — Vector Service Stable ID Regression Tests
 *
 * Verifies:
 * 1. Two indexProjectContent runs on identical data produce the SAME Qdrant point IDs
 *    (stable FNV-1a hash ID, not sequential idx+1)
 * 2. Different content strings produce different point IDs (collision resistance)
 * 3. fnv1a32('') never produces 0 (Qdrant requires positive integers)
 */

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

jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

import { Project } from '../src/models/Project';
import { CrawlJob } from '../src/models/CrawlJob';
import { PageContent } from '../src/models/PageContent';
import { indexProjectContent, fnv1a32 } from '../src/services/vectorService';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

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
// Unit tests for fnv1a32 hash function
// ─────────────────────────────────────────────────────────────────────────────

describe('fnv1a32 — stable hash properties', () => {
  it('Test 1: same input always produces same output (deterministic)', () => {
    const id = 'content-507f1f77bcf86cd799439011-chunk-0';
    expect(fnv1a32(id)).toBe(fnv1a32(id));
    expect(fnv1a32(id)).toBe(fnv1a32(id)); // call multiple times
  });

  it('Test 2: different inputs produce different outputs (collision resistance for typical IDs)', () => {
    const idA = 'content-507f1f77bcf86cd799439011-chunk-0';
    const idB = 'content-507f1f77bcf86cd799439011-chunk-1';
    const idC = 'issue-507f1f77bcf86cd799439012-chunk-0';
    const idD = 'action-507f1f77bcf86cd799439012-chunk-0';

    const hashes = [fnv1a32(idA), fnv1a32(idB), fnv1a32(idC), fnv1a32(idD)];
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(hashes.length); // all distinct
  });

  it('Test 3: always returns a positive non-zero integer', () => {
    const inputs = ['', 'a', 'hello', 'content-abc-chunk-0', '\u0000', 'x'.repeat(100)];
    inputs.forEach((input) => {
      const hash = fnv1a32(input);
      expect(hash).toBeGreaterThan(0);
      expect(Number.isInteger(hash)).toBe(true);
    });
  });

  it('Test 4: result fits within safe 32-bit unsigned integer range', () => {
    const MAX_UINT32 = 0xFFFFFFFF;
    const testIds = Array.from({ length: 50 }, (_, i) => `content-${i}-chunk-${i}`);
    testIds.forEach((id) => {
      const hash = fnv1a32(id);
      expect(hash).toBeGreaterThanOrEqual(1);
      expect(hash).toBeLessThanOrEqual(MAX_UINT32);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration test — Qdrant upsert uses stable IDs across re-index runs
// ─────────────────────────────────────────────────────────────────────────────

describe('indexProjectContent — stable Qdrant point IDs across re-index runs', () => {
  it('Test 5: two indexProjectContent runs produce identical Qdrant point IDs for the same content', async () => {
    const project = await Project.create({
      name: 'Stable ID Test Site',
      domain: 'stableid.com',
      baseUrl: 'https://stableid.com',
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 1,
    });

    await PageContent.create({
      projectId: project._id,
      crawlJobId: crawlJob._id,
      pageUrl: 'https://stableid.com/guide',
      contentType: 'pdf',
      sourceUrl: 'https://stableid.com/guide.pdf',
      extractedText: 'A guide to stable vector database indexing and upsert semantics.',
      extractionStatus: 'success',
    });

    // First index run
    await indexProjectContent(project._id.toString());

    const firstRunCalls = (mockedAxios.put as jest.Mock).mock.calls.filter(
      ([url]: [string]) => String(url).includes('/collections/rankengine_vectors/points')
    );
    expect(firstRunCalls.length).toBeGreaterThanOrEqual(1);

    const firstRunPointIds = firstRunCalls
      .flatMap(([, body]: [string, any]) => body.points.map((p: any) => p.id))
      .sort();

    jest.clearAllMocks();
    mockedAxios.put = jest.fn().mockResolvedValue({ status: 200, data: { result: true } });

    // Second index run — same content
    await indexProjectContent(project._id.toString());

    const secondRunCalls = (mockedAxios.put as jest.Mock).mock.calls.filter(
      ([url]: [string]) => String(url).includes('/collections/rankengine_vectors/points')
    );
    const secondRunPointIds = secondRunCalls
      .flatMap(([, body]: [string, any]) => body.points.map((p: any) => p.id))
      .sort();

    // Critical assertion: point IDs must be IDENTICAL across runs
    expect(secondRunPointIds).toEqual(firstRunPointIds);

    // All IDs must be positive integers (Qdrant requirement)
    firstRunPointIds.forEach((id: number) => {
      expect(id).toBeGreaterThan(0);
      expect(Number.isInteger(id)).toBe(true);
    });
  });
});
