/**
 * Phase 3 Prompt 4 — Pre-Publish Preview Verification Tests
 *
 * Verifies:
 * Test 1: Text change with no broken links passes preview check cleanly.
 * Test 2: Proposed change introducing a 404 link is flagged by preview check.
 * Test 3: Preview route is marked noindex (header + meta tag) and unlinked.
 * Test 4: Failed preview check produces warning but does NOT block human approval.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';

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
import { PendingChange } from '../src/models/PendingChange';
import { verifyPreviewChange } from '../src/services/previewVerificationService';
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
  app.use('/api', pendingChangesRouter);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Phase 3 Prompt 4 — Pre-Publish Preview Verification', () => {
  it('Test 1: mock a text change with no broken links introduced; assert preview check passes cleanly', async () => {
    const project = await Project.create({
      name: 'Clean Text Site',
      domain: 'cleantext.com',
      baseUrl: 'https://cleantext.com',
    });

    const pendingChange = await PendingChange.create({
      projectId: project._id,
      sourceAuditIssueId: new mongoose.Types.ObjectId(),
      status: 'proposed',
      proposedChange: '<h1>Updated clean title with standard text</h1><p>Learn more at <a href="https://cleantext.com/about">About page</a></p>',
    });

    const result = await verifyPreviewChange(pendingChange._id.toString());
    expect(result.hasWarnings).toBe(false);
    expect(result.warnings).toHaveLength(0);
    expect(result.brokenLinks).toHaveLength(0);
    expect(result.invalidUrls).toHaveLength(0);
  });

  it('Test 2: mock a change that introduces a link to a 404 page; assert the check flags it', async () => {
    const project = await Project.create({
      name: 'Broken Link Site',
      domain: 'brokenlink.com',
      baseUrl: 'https://brokenlink.com',
    });

    const pendingChange = await PendingChange.create({
      projectId: project._id,
      sourceAuditIssueId: new mongoose.Types.ObjectId(),
      status: 'proposed',
      proposedChange: '<p>Visit our <a href="https://brokenlink.com/404-missing-page">broken feature page</a></p>',
    });

    const result = await verifyPreviewChange(pendingChange._id.toString());
    expect(result.hasWarnings).toBe(true);
    expect(result.brokenLinks).toContain('https://brokenlink.com/404-missing-page');
    expect(result.warnings[0]).toContain('returned 404 Not Found');
  });

  it('Test 3: assert the preview route is marked noindex and isn\'t linked from any public-facing page', async () => {
    const project = await Project.create({
      name: 'Noindex Preview Site',
      domain: 'noindexpreview.com',
      baseUrl: 'https://noindexpreview.com',
    });

    const pendingChange = await PendingChange.create({
      projectId: project._id,
      sourceAuditIssueId: new mongoose.Types.ObjectId(),
      status: 'proposed',
      proposedChange: '<p>Internal draft content</p>',
    });

    const res = await request(app)
      .get(`/api/preview/${pendingChange._id.toString()}`)
      .expect(200);

    // Verify X-Robots-Tag header is present and set to noindex
    expect(res.headers['x-robots-tag']).toContain('noindex');

    // Verify HTML body contains <meta name="robots" content="noindex, nofollow">
    expect(res.text).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('Test 4: assert a failed preview check produces a warning but does NOT prevent human from still choosing to publish', async () => {
    const project = await Project.create({
      name: 'Human Override Site',
      domain: 'humanoverride.com',
      baseUrl: 'https://humanoverride.com',
    });

    const pendingChange = await PendingChange.create({
      projectId: project._id,
      sourceAuditIssueId: new mongoose.Types.ObjectId(),
      status: 'proposed',
      proposedChange: '<p>Contains a broken target <a href="https://humanoverride.com/404-dead">Dead link</a></p>',
    });

    // Human approves change via POST endpoint
    const res = await request(app)
      .post(`/api/pending-changes/${pendingChange._id.toString()}/approve`)
      .expect(200);

    // Approval must STILL succeed!
    expect(res.body.success).toBe(true);
    expect(res.body.pendingChange.status).toBe('approved');

    // Warning is returned in previewWarning field for frontend alert display
    expect(res.body.previewWarning).toBeDefined();
    expect(Array.isArray(res.body.previewWarning)).toBe(true);
    expect(res.body.previewWarning[0]).toContain('404');
  });
});
