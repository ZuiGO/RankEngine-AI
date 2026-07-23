import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

let mongoServer: MongoMemoryServer;

// Mock BullMQ to prevent tests from needing a running Redis server
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

// Require app & models after mock configuration
import app from '../src/app';
import { Project } from '../src/models/Project';
import { CrawlJob } from '../src/models/CrawlJob';
import { AuditIssue } from '../src/models/AuditIssue';

const request = supertest(app);

let projectAId: string;
let crawlJobId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);

  // Create Project A
  const project = new Project({
    name: 'Checklist Test Project',
    domain: 'https://site-to-check.com',
  });
  await project.save();
  projectAId = project._id.toString();

  // Create CrawlJob
  const job = new CrawlJob({
    projectId: project._id,
    status: 'completed',
    pageCount: 15,
  });
  await job.save();
  crawlJobId = job._id.toString();

  // Seed AuditIssues for checklist
  await AuditIssue.create([
    {
      crawlJobId: job._id,
      severity: 'critical',
      category: 'redirect',
      url: 'https://site.com/a',
      description: 'issue 1',
      recommendation: 'rec 1',
    },
    {
      crawlJobId: job._id,
      severity: 'warning',
      category: 'meta',
      url: 'https://site.com/b',
      description: 'issue 2',
      recommendation: 'rec 2',
    },
    {
      crawlJobId: job._id,
      severity: 'warning',
      category: 'meta',
      url: 'https://site.com/c',
      description: 'issue 3',
      recommendation: 'rec 3',
    },
    {
      crawlJobId: job._id,
      severity: 'passed',
      category: 'meta',
      url: 'https://site.com/d',
      description: 'issue 4',
      recommendation: 'rec 4',
    },
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Checklist REST API', () => {
  it('should fetch the checklist items grouped by severity for the project', async () => {
    const res = await request
      .get(`/api/crawl-jobs/${crawlJobId}/checklist`)
      .expect(200);

    expect(res.body).toHaveProperty('checklist');
    const { checklist } = res.body;

    expect(checklist.critical).toHaveLength(1);
    expect(checklist.warning).toHaveLength(2);
    expect(checklist.passed).toHaveLength(1);

    expect(checklist.critical[0].url).toBe('https://site.com/a');
    const warningUrls = checklist.warning.map((w: any) => w.url);
    expect(warningUrls).toContain('https://site.com/b');
    expect(warningUrls).toContain('https://site.com/c');
    expect(checklist.passed[0].url).toBe('https://site.com/d');
  });

  it('should return 404 for checklists on non-existent jobs', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    await request
      .get(`/api/crawl-jobs/${fakeId}/checklist`)
      .expect(404);
  });
});
