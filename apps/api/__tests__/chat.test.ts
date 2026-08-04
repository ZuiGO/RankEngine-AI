import request from 'supertest';
import { app } from '../src/app';
import { Project } from '../src/models/Project';
import { CrawlJob } from '../src/models/CrawlJob';
import { AuditIssue } from '../src/models/AuditIssue';
import { TrackedKeyword } from '../src/models/TrackedKeyword';
import { RankSnapshot } from '../src/models/RankSnapshot';
import { TrackedPrompt } from '../src/models/TrackedPrompt';
import { AiVisibilitySnapshot } from '../src/models/AiVisibilitySnapshot';
import * as llmService from '../src/services/llmService';
import { searchProjectContent, searchProjectVectors } from '../src/services/vectorService';

jest.mock('../src/models/Project');
jest.mock('../src/models/CrawlJob');
jest.mock('../src/models/AuditIssue');
jest.mock('../src/models/PageContent');
jest.mock('../src/models/TrackedKeyword');
jest.mock('../src/models/RankSnapshot');
jest.mock('../src/models/TrackedPrompt');
jest.mock('../src/models/AiVisibilitySnapshot');
jest.mock('../src/services/llmService');
jest.mock('../src/services/vectorService', () => ({
  searchProjectVectors: jest.fn().mockResolvedValue([]),
  searchProjectContent: jest.fn().mockResolvedValue([]),
  indexProjectContent: jest.fn().mockResolvedValue(0),
}));

const mockedCallGroq = llmService.callGroq as jest.MockedFunction<typeof llmService.callGroq>;

function mockChain(result: any) {
  const query = {
    sort: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
  };
  return query;
}

const mockProject = { _id: '507f1f77bcf86cd799439011', name: 'Test', domain: 'example.com', deletedAt: null };
const mockCrawlJob = { _id: '507f1f77bcf86cd799439012', healthScore: 72, completedAt: new Date() };
const mockCriticalIssues = [
  { description: 'Missing meta descriptions on 5 pages' },
  { description: 'Duplicate H1 tags detected' },
  { description: 'Slow page load speed on 3 key pages' },
];
const mockKeywords = [
  { _id: '507f1f77bcf86cd799439013', keyword: 'seo tips' },
  { _id: '507f1f77bcf86cd799439014', keyword: 'content marketing' },
];
const mockPrompts = [{ _id: '507f1f77bcf86cd799439015' }];

describe('POST /api/projects/:id/chat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls LLM with context containing health score and rank trend data', async () => {
    (Project.findOne as jest.Mock).mockResolvedValue(mockProject);
    (CrawlJob.findOne as jest.Mock).mockReturnValue(mockChain(mockCrawlJob));
    (AuditIssue.find as jest.Mock).mockReturnValue(mockChain(mockCriticalIssues));
    (TrackedKeyword.find as jest.Mock).mockReturnValue(mockChain(mockKeywords));
    (TrackedPrompt.find as jest.Mock).mockReturnValue(mockChain(mockPrompts));

    (RankSnapshot.findOne as jest.Mock).mockImplementation((query: any) => {
      if (query.date && (query.date as any).$lte) {
        return mockChain({ position: 18, date: new Date() });
      }
      return mockChain({ position: 5, date: new Date() });
    });

    (AiVisibilitySnapshot.findOne as jest.Mock).mockImplementation((query: any) => {
      const isOld = query.checkedAt && (query.checkedAt as any).$lte;
      return mockChain({ mentioned: isOld ? false : true });
    });

    mockedCallGroq.mockResolvedValue({ answer: 'Based on your audit data...' });

    const res = await request(app)
      .post('/api/projects/507f1f77bcf86cd799439011/chat')
      .send({ question: 'What should I fix first?' })
      .expect(200);

    expect(res.body).toEqual({ answer: 'Based on your audit data...' });

    expect(mockedCallGroq).toHaveBeenCalledTimes(1);
    const callArg = mockedCallGroq.mock.calls[0][0];

    expect(callArg).toContain('Health Score: 72');
    expect(callArg).toContain('seo tips: pos 5');
    expect(callArg).toContain('content marketing: pos 5');
    expect(callArg).toContain('AI Visibility');
  });

  it('returns deterministic message and never calls LLM when no audit data exists', async () => {
    (Project.findOne as jest.Mock).mockResolvedValue(mockProject);
    (CrawlJob.findOne as jest.Mock).mockReturnValue(mockChain(null));

    const res = await request(app)
      .post('/api/projects/507f1f77bcf86cd799439011/chat')
      .send({ question: 'How is my site doing?' })
      .expect(200);

    expect(res.body).toEqual({
      answer: "I don't have any audit data for this project yet — run an audit first so I have something to work with.",
    });

    expect(mockedCallGroq).toHaveBeenCalledTimes(0);
  });

  it('includes no-traffic-data scoping rule in LLM prompt and no fabricated traffic numbers', async () => {
    (Project.findOne as jest.Mock).mockResolvedValue(mockProject);
    (CrawlJob.findOne as jest.Mock).mockReturnValue(mockChain(mockCrawlJob));
    (AuditIssue.find as jest.Mock).mockReturnValue(mockChain(mockCriticalIssues));
    (TrackedKeyword.find as jest.Mock).mockReturnValue(mockChain(mockKeywords));
    (TrackedPrompt.find as jest.Mock).mockReturnValue(mockChain(mockPrompts));

    (RankSnapshot.findOne as jest.Mock).mockImplementation((query: any) => {
      if (query.date && (query.date as any).$lte) {
        return mockChain({ position: 18, date: new Date() });
      }
      return mockChain({ position: 5, date: new Date() });
    });

    (AiVisibilitySnapshot.findOne as jest.Mock).mockImplementation((query: any) => {
      const isOld = query.checkedAt && (query.checkedAt as any).$lte;
      return mockChain({ mentioned: isOld ? false : true });
    });

    mockedCallGroq.mockResolvedValue({ answer: 'RankEngine does not have traffic data...' });

    const res = await request(app)
      .post('/api/projects/507f1f77bcf86cd799439011/chat')
      .send({ question: 'why did my traffic drop' })
      .expect(200);

    expect(mockedCallGroq).toHaveBeenCalledTimes(1);
    const callArg = mockedCallGroq.mock.calls[0][0];

    const trafficRegex = /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:visitors|traffic|sessions|users|pageviews)\b/i;
    const matches = callArg.match(trafficRegex);
    expect(matches).toBeNull();

    expect(callArg).toContain('NO Google Analytics');
    expect(callArg).toContain('does NOT know');
    expect(callArg).toContain('audit findings');
  });

  it('Test 1: request with section "content" and question calls searchProjectContent and includes results in LLM context', async () => {
    (Project.findOne as jest.Mock).mockResolvedValue(mockProject);
    (CrawlJob.findOne as jest.Mock).mockReturnValue(mockChain(mockCrawlJob));
    (AuditIssue.find as jest.Mock).mockReturnValue(mockChain(mockCriticalIssues));
    (TrackedKeyword.find as jest.Mock).mockReturnValue(mockChain([]));
    (TrackedPrompt.find as jest.Mock).mockReturnValue(mockChain([]));

    const mockVectorMatches = [
      {
        id: 'vector-1',
        pageUrl: 'https://example.com/pdf-report.pdf',
        contentType: 'pdf',
        contentId: 'c1',
        section: 'Content',
        chunkText: 'Extracted PDF text regarding financial metrics',
        score: 0.95,
      },
    ];

    (searchProjectContent as jest.Mock).mockResolvedValue(mockVectorMatches);
    (searchProjectVectors as jest.Mock).mockResolvedValue(mockVectorMatches);
    mockedCallGroq.mockResolvedValue({ answer: 'Found PDF information on page...' });

    await request(app)
      .post('/api/projects/507f1f77bcf86cd799439011/chat')
      .send({ question: 'What is inside the PDF?', section: 'content' })
      .expect(200);

    const callFn = (searchProjectContent as jest.Mock).mock.calls.length > 0
      ? (searchProjectContent as jest.Mock)
      : (searchProjectVectors as jest.Mock);

    expect(callFn).toHaveBeenCalled();
    expect(mockedCallGroq).toHaveBeenCalledTimes(1);
    const prompt = mockedCallGroq.mock.calls[0][0];
    expect(prompt).toContain('Extracted PDF text regarding financial metrics');
    expect(prompt).toContain('https://example.com/pdf-report.pdf');
  });

  it('Test 2: response includes source page attribution (citations array & vectorMatches) when answering from retrieved content', async () => {
    (Project.findOne as jest.Mock).mockResolvedValue(mockProject);
    (CrawlJob.findOne as jest.Mock).mockReturnValue(mockChain(mockCrawlJob));
    (AuditIssue.find as jest.Mock).mockReturnValue(mockChain([]));
    (TrackedKeyword.find as jest.Mock).mockReturnValue(mockChain([]));
    (TrackedPrompt.find as jest.Mock).mockReturnValue(mockChain([]));

    const mockVectorMatches = [
      {
        id: 'vector-2',
        pageUrl: 'https://example.com/whitepaper',
        contentType: 'text',
        contentId: 'c2',
        section: 'Content',
        chunkText: 'Whitepaper content chunk detailing SEO strategy',
        score: 0.88,
      },
    ];

    (searchProjectContent as jest.Mock).mockResolvedValue(mockVectorMatches);
    (searchProjectVectors as jest.Mock).mockResolvedValue(mockVectorMatches);
    mockedCallGroq.mockResolvedValue({ answer: 'According to https://example.com/whitepaper...' });

    const res = await request(app)
      .post('/api/projects/507f1f77bcf86cd799439011/chat')
      .send({ question: 'Summarize the strategy whitepaper', section: 'Content' })
      .expect(200);

    expect(res.body.citations).toBeDefined();
    expect(res.body.citations).toContain('https://example.com/whitepaper');
    expect(res.body.vectorMatches).toBeDefined();
    expect(res.body.vectorMatches[0].pageUrl).toBe('https://example.com/whitepaper');
  });

  it('Test 3: request with section "overview" uses existing structured-summary path and does NOT call vector search', async () => {
    (Project.findOne as jest.Mock).mockResolvedValue(mockProject);
    (CrawlJob.findOne as jest.Mock).mockReturnValue(mockChain(mockCrawlJob));
    (AuditIssue.find as jest.Mock).mockReturnValue(mockChain(mockCriticalIssues));
    (TrackedKeyword.find as jest.Mock).mockReturnValue(mockChain(mockKeywords));
    (TrackedPrompt.find as jest.Mock).mockReturnValue(mockChain(mockPrompts));

    (RankSnapshot.findOne as jest.Mock).mockImplementation((query: any) => {
      if (query.date && (query.date as any).$lte) {
        return mockChain({ position: 18, date: new Date() });
      }
      return mockChain({ position: 5, date: new Date() });
    });

    (AiVisibilitySnapshot.findOne as jest.Mock).mockImplementation((query: any) => {
      const isOld = query.checkedAt && (query.checkedAt as any).$lte;
      return mockChain({ mentioned: isOld ? false : true });
    });

    mockedCallGroq.mockResolvedValue({ answer: 'Overview summary answer...' });

    await request(app)
      .post('/api/projects/507f1f77bcf86cd799439011/chat')
      .send({ question: 'Give me a summary of my project', section: 'overview' })
      .expect(200);

    expect(searchProjectContent as jest.Mock).not.toHaveBeenCalled();
    expect(searchProjectVectors as jest.Mock).not.toHaveBeenCalled();

    expect(mockedCallGroq).toHaveBeenCalledTimes(1);
    const prompt = mockedCallGroq.mock.calls[0][0];
    expect(prompt).toContain('Health Score: 72');
    expect(prompt).toContain('Top Critical Issues');
  });
});

