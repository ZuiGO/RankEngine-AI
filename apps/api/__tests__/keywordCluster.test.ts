import request from 'supertest';
import { app } from '../src/app';
import * as llmService from '../src/services/llmService';

jest.mock('../src/services/llmService');

const mockedCallGroq = llmService.callGroq as jest.MockedFunction<typeof llmService.callGroq>;

const TEN_KEYWORDS = [
  'kw1', 'kw2', 'kw3', 'kw4', 'kw5',
  'kw6', 'kw7', 'kw8', 'kw9', 'kw10',
];

describe('POST /api/keyword-research/cluster', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with clusters covering all keywords across 3 clusters', async () => {
    const mockResponse = {
      clusters: [
        { topicName: 'Cluster A', keywords: ['kw1', 'kw2', 'kw3'] },
        { topicName: 'Cluster B', keywords: ['kw4', 'kw5', 'kw6'] },
        { topicName: 'Cluster C', keywords: ['kw7', 'kw8', 'kw9', 'kw10'] },
      ],
    };

    mockedCallGroq.mockResolvedValue(mockResponse);

    const res = await request(app)
      .post('/api/keyword-research/cluster')
      .send({ keywords: TEN_KEYWORDS })
      .expect(200);

    expect(res.body).toEqual(mockResponse);

    const assigned = res.body.clusters.flatMap((c: { keywords: string[] }) => c.keywords) as string[];
    expect(assigned.sort()).toEqual([...TEN_KEYWORDS].sort());
    expect(new Set(assigned).size).toBe(10); // no duplicates
  });

  it('retries when LLM drops a keyword and returns 502 after second failure', async () => {
    const incompleteResponse = {
      clusters: [
        { topicName: 'Cluster A', keywords: ['kw1', 'kw2', 'kw3', 'kw4', 'kw5', 'kw6', 'kw7', 'kw8', 'kw9'] },
      ],
    };

    mockedCallGroq.mockResolvedValue(incompleteResponse);

    const res = await request(app)
      .post('/api/keyword-research/cluster')
      .send({ keywords: TEN_KEYWORDS })
      .expect(502);

    expect(res.body).toEqual({ error: 'Could not generate valid clusters after retry' });
    expect(mockedCallGroq).toHaveBeenCalledTimes(2);
  });

  it('returns 400 when fewer than 2 keywords are provided', async () => {
    const res = await request(app)
      .post('/api/keyword-research/cluster')
      .send({ keywords: ['only'] })
      .expect(400);

    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 with specific message when more than 300 keywords are provided', async () => {
    const keywords = Array.from({ length: 301 }, (_, i) => `kw${i}`);

    const res = await request(app)
      .post('/api/keyword-research/cluster')
      .send({ keywords })
      .expect(400);

    expect(res.body).toEqual({ error: 'Maximum 300 keywords per clustering request' });
  });
});
