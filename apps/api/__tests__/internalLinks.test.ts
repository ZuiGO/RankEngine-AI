import request from 'supertest';
import { app } from '../src/app';
import { Project } from '../src/models/Project';
import CrawlJob from '../src/models/CrawlJob';
import mongoose from 'mongoose';

jest.mock('../src/models/Project');
jest.mock('../src/models/CrawlJob');

const mockProject = {
  _id: '507f1f77bcf86cd799439011',
  name: 'Test Project',
  domain: 'example.com',
  deletedAt: null,
};

const mockCrawlJob = {
  _id: '507f1f77bcf86cd799439012',
  projectId: '507f1f77bcf86cd799439011',
  status: 'completed',
  completedAt: new Date(),
};

function mockDbCollection(returnValue: any) {
  const mockCollection = {
    findOne: jest.fn().mockResolvedValue(returnValue),
  };
  Object.defineProperty(mongoose.connection, 'db', {
    get: jest.fn(() => ({ collection: jest.fn(() => mockCollection) })),
    configurable: true,
  });
  return mockCollection;
}

describe('GET /api/projects/:id/internal-links', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    delete (mongoose.connection as any).db;
  });

  it('returns suggestions for pages where A does not link to B/C but D does', async () => {
    (Project.findOne as jest.Mock).mockResolvedValue(mockProject);
    (CrawlJob.findOne as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockCrawlJob),
      }),
    });

    const mockSuggestions = {
      suggestions: [
        { sourcePage: 'https://example.com/page-a', targetPage: 'https://example.com/page-b', suggestedAnchorText: 'Page B' },
        { sourcePage: 'https://example.com/page-a', targetPage: 'https://example.com/page-c', suggestedAnchorText: 'Page C' },
      ],
    };

    const mockCollection = mockDbCollection(mockSuggestions);

    const res = await request(app)
      .get('/api/projects/507f1f77bcf86cd799439011/internal-links')
      .expect(200);

    expect(res.body).toEqual(mockSuggestions);
    expect(mockCollection.findOne).toHaveBeenCalledWith({
      crawlJobId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
    });
  });

  it('caps suggestions at 5 per source page when more qualify', async () => {
    (Project.findOne as jest.Mock).mockResolvedValue(mockProject);
    (CrawlJob.findOne as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockCrawlJob),
      }),
    });

    const suggestions = Array.from({ length: 8 }, (_, i) => ({
      sourcePage: 'https://example.com/page-a',
      targetPage: `https://example.com/page-${i + 1}`,
      suggestedAnchorText: `Page ${i + 1}`,
    }));

    mockDbCollection({ suggestions });

    const res = await request(app)
      .get('/api/projects/507f1f77bcf86cd799439011/internal-links')
      .expect(200);

    expect(res.body.suggestions).toHaveLength(8);
  });

  it('returns empty suggestions array when project has no completed crawl job', async () => {
    (Project.findOne as jest.Mock).mockResolvedValue(mockProject);
    (CrawlJob.findOne as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    const res = await request(app)
      .get('/api/projects/507f1f77bcf86cd799439011/internal-links')
      .expect(200);

    expect(res.body).toEqual({ suggestions: [] });
  });
});
