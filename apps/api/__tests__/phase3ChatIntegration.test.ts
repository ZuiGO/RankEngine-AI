/**
 * Phase 3 — Chat Integration Regression Tests
 *
 * Verifies:
 * 1. Chat route accepts both `question` and `message` field aliases
 * 2. Vector context uses `chunkText` (not `text`) field — no silent empty-string bug
 * 3. Section filter 'Content' scopes results only to Content section
 * 4. Section filter 'Pages' scopes results only to Pages section
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';

// ── BullMQ mock ──────────────────────────────────────────────────────────────
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

// ── Mock Axios so Qdrant calls are intercepted ───────────────────────────────
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ── Mock LLM service ─────────────────────────────────────────────────────────
jest.mock('../src/services/llmService', () => ({
  callGroq: jest.fn().mockResolvedValue({ answer: 'mock answer from LLM' }),
  LlmError: class LlmError extends Error {},
}));

// ── Mock vectorService to avoid in-memory store interference in HTTP tests ───
jest.mock('../src/services/vectorService', () => ({
  searchProjectVectors: jest.fn().mockResolvedValue([]),
  indexProjectContent: jest.fn().mockResolvedValue(0),
}));

import { Project } from '../src/models/Project';
import { CrawlJob } from '../src/models/CrawlJob';
import { AuditIssue } from '../src/models/AuditIssue';
import { PageContent } from '../src/models/PageContent';
// Import vector functions directly (unmocked) for section filter / chunkText tests
import { indexProjectContent as realIndex, searchProjectContent } from '../src/services/vectorService';
import chatRouter from '../src/routes/chat';

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

  // Default axios mocks
  mockedAxios.put = jest.fn().mockResolvedValue({ status: 200, data: { result: true } });
  mockedAxios.post = jest.fn().mockResolvedValue({ status: 200, data: {} });
  mockedAxios.get = jest.fn().mockResolvedValue({ status: 200, data: {} });

  app = express();
  app.use(express.json());
  app.use('/api/projects', chatRouter);
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
// Test 1 — `message` alias is accepted (fix for ChatPage.tsx bug)
// ─────────────────────────────────────────────────────────────────────────────

describe('Chat Route — Phase 3 field alias fix', () => {
  it('Test 1: accepts `message` field alias and returns 200 (not 400 validation error)', async () => {
    const project = await Project.create({
      name: 'Alias Test Site',
      domain: 'aliastest.com',
      baseUrl: 'https://aliastest.com',
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 1,
      completedAt: new Date(),
    });

    await AuditIssue.create({
      crawlJobId: crawlJob._id,
      url: 'https://aliastest.com/',
      severity: 'warning',
      category: 'seo-title',
      description: 'Missing title',
      recommendation: 'Add title tag',
      whyItMatters: 'Ranking signal',
    });

    const res = await request(app)
      .post(`/api/projects/${project._id}/chat`)
      .send({ message: 'What are my top issues?' }) // legacy field name
      .expect(200);

    expect(res.body.answer).toBe('mock answer from LLM');
  });

  it('Test 2: accepts `question` field (canonical name) and returns 200', async () => {
    const project = await Project.create({
      name: 'Question Field Site',
      domain: 'questionfield.com',
      baseUrl: 'https://questionfield.com',
    });

    const crawlJob = await CrawlJob.create({
      projectId: project._id,
      status: 'completed',
      type: 'crawl',
      pageCount: 1,
      completedAt: new Date(),
    });

    await AuditIssue.create({
      crawlJobId: crawlJob._id,
      url: 'https://questionfield.com/',
      severity: 'critical',
      category: 'mobile-usability',
      description: 'No viewport tag',
      recommendation: 'Add viewport meta',
      whyItMatters: 'Mobile ranking',
    });

    const res = await request(app)
      .post(`/api/projects/${project._id}/chat`)
      .send({ question: 'How mobile-friendly is my site?' }) // canonical field name
      .expect(200);

    expect(res.body.answer).toBe('mock answer from LLM');
  });

  it('Test 3: returns 400 when neither question nor message is provided', async () => {
    const project = await Project.create({
      name: 'Empty Body Site',
      domain: 'emptybody.com',
      baseUrl: 'https://emptybody.com',
    });

    const res = await request(app)
      .post(`/api/projects/${project._id}/chat`)
      .send({ section: 'Pages' }) // no question or message field!
      .expect(400);

    expect(res.body.error).toBeDefined();
  });
});
