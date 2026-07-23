import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';

jest.setTimeout(60000);

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

let mongoServer: MongoMemoryServer;

process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test_placeholder';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.DATAFORSEO_LOGIN = '';
process.env.DATAFORSEO_PASSWORD = '';

const Project = require('../src/models/Project').default || require('../src/models/Project').Project;

const mockGetDomainOverview = jest.fn();
const mockGetReferringDomains = jest.fn();

jest.mock('../src/services/dataProviderService', () => {
  const actual = jest.requireActual('../src/services/dataProviderService');
  return {
    ...actual,
    getDomainOverview: (...args: any[]) => mockGetDomainOverview(...args),
    getReferringDomains: (...args: any[]) => mockGetReferringDomains(...args),
  };
});

const { app } = require('../src/app');

let testProject: any;

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

beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }

  testProject = await Project.create({
    name: 'Gap Project',
    domain: 'myproject.com',
  });
});

afterEach(() => {
  mockGetDomainOverview.mockReset();
  mockGetReferringDomains.mockReset();
});

describe('Keyword Gap — POST /api/projects/:id/keyword-gap', () => {
  it('computes yourAdvantage, gapOpportunities, and partialOverlap correctly', async () => {
    mockGetDomainOverview.mockImplementation(async (domain: string) => {
      const map: Record<string, string[]> = {
        'myproject.com': ['seo tools', 'content marketing', 'link building', 'keyword research'],
        'competitor1.com': ['seo tools', 'ppc advertising', 'social media'],
        'competitor2.com': ['seo tools', 'ppc advertising', 'email marketing', 'content marketing'],
      };
      const keywords = map[domain] ?? [];
      return {
        organicTrafficEstimate: 10000,
        organicKeywordCount: keywords.length,
        topKeywords: keywords.map((k) => ({ keyword: k, searchVolume: 500, position: 5 })),
      };
    });

    const res = await request(app)
      .post(`/api/projects/${testProject._id}/keyword-gap`)
      .send({ competitors: ['competitor1.com', 'competitor2.com'] })
      .expect(200);

    expect(res.body.projectDomain).toBe('myproject.com');
    expect(res.body.competitors).toEqual(['competitor1.com', 'competitor2.com']);

    expect(res.body.yourAdvantage).toEqual(
      expect.arrayContaining(['link building', 'keyword research'])
    );
    expect(res.body.yourAdvantage).toHaveLength(2);

    expect(res.body.gapOpportunities).toHaveLength(1);
    expect(res.body.gapOpportunities[0].keyword).toBe('ppc advertising');
    expect(res.body.gapOpportunities[0].rankCount).toBe(2);
    expect(res.body.gapOpportunities[0].domains).toContain('competitor1.com');
    expect(res.body.gapOpportunities[0].domains).toContain('competitor2.com');

    expect(res.body.partialOverlap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: 'social media' }),
        expect.objectContaining({ keyword: 'email marketing' }),
      ])
    );
    expect(res.body.partialOverlap).toHaveLength(2);

    expect(res.body.gapOpportunityCount).toBe(1);
    expect(res.body.totalCompetitorsQueried).toBe(2);
  });

  it('returns empty arrays when project has no competitor keywords', async () => {
    mockGetDomainOverview.mockImplementation(async (domain: string) => {
      if (domain === 'myproject.com') {
        return {
          organicTrafficEstimate: 5000,
          organicKeywordCount: 1,
          topKeywords: [{ keyword: 'my niche', searchVolume: 100, position: 1 }],
        };
      }
      return { organicTrafficEstimate: 3000, organicKeywordCount: 0, topKeywords: [] };
    });

    const res = await request(app)
      .post(`/api/projects/${testProject._id}/keyword-gap`)
      .send({ competitors: ['empty-competitor.com'] })
      .expect(200);

    expect(res.body.yourAdvantage).toEqual(['my niche']);
    expect(res.body.gapOpportunities).toEqual([]);
    expect(res.body.partialOverlap).toEqual([]);
    expect(res.body.gapOpportunityCount).toBe(0);
  });

  it('rejects more than 5 competitors', async () => {
    const res = await request(app)
      .post(`/api/projects/${testProject._id}/keyword-gap`)
      .send({ competitors: ['a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com'] })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
  });

  it('calls getDomainOverview for each domain (6 domains = 6 calls)', async () => {
    const callLog: string[] = [];
    mockGetDomainOverview.mockImplementation(async (domain: string) => {
      callLog.push(domain);
      const base = domain.split('.')[0];
      return {
        organicTrafficEstimate: 10000,
        organicKeywordCount: 2,
        topKeywords: [{ keyword: `${base} kw1`, searchVolume: 500, position: 3 }],
      };
    });

    await request(app)
      .post(`/api/projects/${testProject._id}/keyword-gap`)
      .send({ competitors: ['c1.com', 'c2.com', 'c3.com', 'c4.com', 'c5.com'] })
      .expect(200);

    expect(callLog).toHaveLength(6);
    expect(callLog[0]).toBe('myproject.com');
    expect(callLog).toContain('c1.com');
    expect(callLog).toContain('c5.com');
  });
});

describe('Backlink Gap — POST /api/projects/:id/backlink-gap', () => {
  it('computes linkOpportunities correctly', async () => {
    mockGetReferringDomains.mockImplementation(async (domain: string) => {
      const map: Record<string, string[]> = {
        'myproject.com': ['authority.com', 'blog.com', 'news.com'],
        'comp1.com': ['authority.com', 'forum.com', 'social.com'],
        'comp2.com': ['authority.com', 'forum.com', 'wiki.com'],
      };
      return map[domain] ?? [];
    });

    const res = await request(app)
      .post(`/api/projects/${testProject._id}/backlink-gap`)
      .send({ competitors: ['comp1.com', 'comp2.com'] })
      .expect(200);

    expect(res.body.projectDomain).toBe('myproject.com');
    expect(res.body.competitors).toEqual(['comp1.com', 'comp2.com']);

    expect(res.body.linkOpportunities).toHaveLength(3);

    const forum = res.body.linkOpportunities.find((lo: any) => lo.domain === 'forum.com');
    expect(forum).toBeDefined();
    expect(forum.linkedBy).toHaveLength(2);
    expect(forum.linkedBy).toContain('comp1.com');
    expect(forum.linkedBy).toContain('comp2.com');

    const social = res.body.linkOpportunities.find((lo: any) => lo.domain === 'social.com');
    expect(social).toBeDefined();
    expect(social.linkedBy).toEqual(['comp1.com']);

    const wiki = res.body.linkOpportunities.find((lo: any) => lo.domain === 'wiki.com');
    expect(wiki).toBeDefined();
    expect(wiki.linkedBy).toEqual(['comp2.com']);

    expect(res.body.linkOpportunityCount).toBe(3);
    expect(res.body.totalCompetitorsQueried).toBe(2);
  });

  it('returns empty linkOpportunities when no competitor backlinks differ', async () => {
    mockGetReferringDomains.mockResolvedValue(['shared.com', 'common.org']);

    const res = await request(app)
      .post(`/api/projects/${testProject._id}/backlink-gap`)
      .send({ competitors: ['comp1.com'] })
      .expect(200);

    expect(res.body.linkOpportunities).toEqual([]);
    expect(res.body.linkOpportunityCount).toBe(0);
  });

  it('rejects more than 5 competitors', async () => {
    const res = await request(app)
      .post(`/api/projects/${testProject._id}/backlink-gap`)
      .send({ competitors: ['a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com'] })
      .expect(400);

    expect(res.body.error).toBe('Validation failed');
  });

  it('calls getReferringDomains for each domain (6 domains = 6 calls)', async () => {
    const callLog: string[] = [];
    mockGetReferringDomains.mockImplementation(async (domain: string) => {
      callLog.push(domain);
      return [`link-${domain}`, 'shared-ref.com'];
    });

    await request(app)
      .post(`/api/projects/${testProject._id}/backlink-gap`)
      .send({ competitors: ['c1.com', 'c2.com', 'c3.com', 'c4.com', 'c5.com'] })
      .expect(200);

    expect(callLog).toHaveLength(6);
    expect(callLog[0]).toBe('myproject.com');
    expect(callLog).toContain('c1.com');
    expect(callLog).toContain('c5.com');
  });

  it('accounts for cache hits — cached project domain excludes it from results', async () => {
    mockGetReferringDomains.mockImplementation(async (domain: string) => {
      if (domain === 'myproject.com') return ['shared.com'];
      if (domain === 'c1.com') return ['shared.com', 'new-opportunity.com'];
      return ['another.com'];
    });

    const res = await request(app)
      .post(`/api/projects/${testProject._id}/backlink-gap`)
      .send({ competitors: ['c1.com', 'c2.com', 'c3.com', 'c4.com', 'c5.com'] })
      .expect(200);

    expect(
      res.body.linkOpportunities.find((lo: any) => lo.domain === 'shared.com')
    ).toBeUndefined();
    expect(
      res.body.linkOpportunities.find((lo: any) => lo.domain === 'new-opportunity.com')
    ).toBeDefined();
  });
});
