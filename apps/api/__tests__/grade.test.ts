import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

let mongoServer: MongoMemoryServer;

// Mock BullMQ
jest.mock('bullmq', () => {
  return {
    Queue: jest.fn(),
    Worker: jest.fn(),
    QueueEvents: jest.fn(),
  };
});

import app from '../src/app';
const request = supertest(app);
import { _clearRateLimitStore } from '../src/middleware/rateLimiter';

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  process.env.MONGODB_URI = uri;

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);
});

beforeEach(async () => {
  await _clearRateLimitStore();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Content Grader API', () => {
  it('should score low on entityCoverage when 0 shared entities are present in text', async () => {
    const res = await request
      .post('/api/content/grade')
      .send({
        text: 'This is a generic paragraph about something else completely.',
        targetKeyword: 'generic',
        sharedEntities: ['SEO Optimizer', 'Structured Schema', 'Google Rankings'],
      })
      .expect(200);

    expect(res.body).toHaveProperty('score');
    expect(res.body.breakdown.entityCoverage).toBe(0);
    // Lower total score because entity coverage is 0
    expect(res.body.score).toBeLessThan(60);
  });

  it('should score high on entityCoverage and structureScore when criteria are met', async () => {
    const textWithStructure = `
# Content Optimization Strategy

This is paragraph one containing a healthy amount of keywords and words about SEO tools. We want to check if the structure grader resolves this cleanly.

## Key Search Parameters

This is paragraph two. We are writing multiple words to ensure we pass the paragraph length filter of 20 words min. Let us expand this sentence as a sample template.
    `;

    const res = await request
      .post('/api/content/grade')
      .send({
        text: textWithStructure,
        targetKeyword: 'optimization',
        sharedEntities: ['optimization', 'SEO tools'],
      })
      .expect(200);

    const { score, breakdown } = res.body;

    // Both entities are in the text
    expect(breakdown.entityCoverage).toBe(100);
    // Contains 2 headings and 2 good paragraphs
    expect(breakdown.structureScore).toBe(100);
    // Overall score should be high
    expect(score).toBeGreaterThan(80);
  });

  it('should rate limit requests exceeding 10 requests per second', async () => {
    // Fire 10 requests sequentially
    for (let i = 0; i < 10; i++) {
      await request
        .post('/api/content/grade')
        .send({ text: 'Test content request' })
        .expect(200);
    }

    // The 11th request must fail with 429 Too Many Requests
    const res = await request
      .post('/api/content/grade')
      .send({ text: 'Eleventh request' })
      .expect(429);

    expect(res.body).toEqual({
      error: 'Too many requests, please try again later.',
      retryAfterMs: expect.any(Number),
    });
    expect(res.body.retryAfterMs).toBeGreaterThan(0);
  });
});
