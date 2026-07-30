import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

let mongoServer: MongoMemoryServer;

jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation(() => ({
      add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
      close: jest.fn().mockResolvedValue(undefined),
    })),
    Worker: jest.fn(),
    QueueEvents: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

import app from '../src/app';
import { Project } from '../src/models/Project';

const request = supertest(app);
let projectId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  const project = new Project({
    name: 'CWV Test Project',
    domain: 'apple.com',
  });
  await project.save();
  projectId = project._id.toString();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Core Web Vitals REST API', () => {
  it('should fetch real-time Core Web Vitals metrics for a valid project', async () => {
    const res = await request
      .get(`/api/projects/${projectId}/cwv`)
      .expect(200);

    expect(res.body).toHaveProperty('url', 'https://apple.com');
    expect(res.body).toHaveProperty('overallScore');
    expect(typeof res.body.overallScore).toBe('number');
    expect(res.body.overallScore).toBeGreaterThanOrEqual(0);
    expect(res.body.overallScore).toBeLessThanOrEqual(100);

    expect(res.body).toHaveProperty('metrics');
    const { metrics } = res.body;

    expect(metrics).toHaveProperty('lcp');
    expect(metrics).toHaveProperty('inp');
    expect(metrics).toHaveProperty('cls');
    expect(metrics).toHaveProperty('fcp');
    expect(metrics).toHaveProperty('ttfb');

    expect(['good', 'needs-improvement', 'poor']).toContain(metrics.lcp.rating);
    expect(['good', 'needs-improvement', 'poor']).toContain(metrics.cls.rating);
    expect(['good', 'needs-improvement', 'poor']).toContain(metrics.ttfb.rating);

    expect(res.body).toHaveProperty('indexingStatus');
    expect(res.body.indexingStatus).toHaveProperty('accessible');
    expect(res.body).toHaveProperty('source');
    expect(['pagespeed-api', 'live-probe', 'crawl-data']).toContain(res.body.source);
  });

  it('should return 404 for non-existent project IDs', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await request
      .get(`/api/projects/${fakeId}/cwv`)
      .expect(404);
  });
});
