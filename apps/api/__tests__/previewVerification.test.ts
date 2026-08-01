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
import { verifyApprovedChanges } from '../src/services/previewVerificationService';
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

describe('Pre-Publish Verification Tests', () => {
  it('passes verification for clean approved changes and transitions status to applied', async () => {
    const project = await Project.create({
      name: 'Verify Clean Site',
      domain: 'cleanverify.com',
      baseUrl: 'https://cleanverify.com',
    });

    const pendingChange = await PendingChange.create({
      projectId: project._id,
      sourceAuditIssueId: new mongoose.Types.ObjectId(),
      status: 'approved',
      proposedChange: '<title>Updated About Page Title</title>',
    });

    const report = await verifyApprovedChanges(project._id.toString());
    expect(report.status).toBe('passed');
    expect(report.verifiedChangesCount).toBe(1);
    expect(report.appliedCount).toBe(1);
    expect(report.issues).toHaveLength(0);

    const updated = await PendingChange.findById(pendingChange._id);
    expect(updated!.status).toBe('applied');
  });

  it('fails verification and catches broken links prior to publishing', async () => {
    const project = await Project.create({
      name: 'Verify Broken Site',
      domain: 'brokenverify.com',
      baseUrl: 'https://brokenverify.com',
    });

    const pendingChange = await PendingChange.create({
      projectId: project._id,
      sourceAuditIssueId: new mongoose.Types.ObjectId(),
      status: 'approved',
      proposedChange: 'Check out <a href="https://brokenverify.com/404-link">our missing post</a>',
    });

    const report = await verifyApprovedChanges(project._id.toString());
    expect(report.status).toBe('failed');
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.issues[0].issueType).toBe('broken_link');

    const updated = await PendingChange.findById(pendingChange._id);
    expect(updated!.status).toBe('approved'); // Remains approved, not applied!
  });

  it('POST /api/pending-changes/verify endpoint returns verification report', async () => {
    const project = await Project.create({
      name: 'API Verify Site',
      domain: 'apiverify.com',
      baseUrl: 'https://apiverify.com',
    });

    const res = await request(app)
      .post('/api/pending-changes/verify')
      .send({ projectId: project._id.toString() })
      .expect(200);

    expect(res.body.report).toBeDefined();
    expect(res.body.report.status).toBe('passed');
  });
});
