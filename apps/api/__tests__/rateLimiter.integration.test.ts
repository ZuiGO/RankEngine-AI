import request from 'supertest';
import express from 'express';
import app from '../src/app';
import { rateLimiter, _clearRateLimitStore } from '../src/middleware/rateLimiter';
import CrawlJob from '../src/models/CrawlJob';

jest.mock('../src/models/CrawlJob');

describe('Rate Limiter Integration Tests', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await _clearRateLimitStore();
  });

  describe('Test 1: Polling Cadence on Unthrottled UI Route', () => {
    it('allows 30 requests to GET /api/crawl-jobs/:id without hitting rate limits (simulating 90s polling)', async () => {
      (CrawlJob.findById as jest.Mock).mockResolvedValue(null);
      const validObjectId = '507f1f77bcf86cd799439011';

      // Fire 30 sequential requests simulating 3-second polling interval over 90 seconds
      for (let i = 0; i < 30; i++) {
        const res = await request(app).get(`/api/crawl-jobs/${validObjectId}`);
        // Endpoint returns 404 (Job not found), but must NOT return 429 (Too Many Requests)
        expect(res.status).not.toBe(429);
        expect(res.status).toBe(404);
      }
    }, 15000);
  });

  describe('Test 2: Paid API Protection Rate Limiting', () => {
    it('returns 429 with clear error message when paid-API limit is exceeded', async () => {
      const testApp = express();
      testApp.set('trust proxy', 1);

      // Create a paid route protected by rateLimiter with limit 5
      testApp.use(
        '/api/paid-test',
        rateLimiter(5, 60000),
        (_req, res) => res.json({ success: true })
      );

      const clientIp = '198.51.100.42';

      // First 5 requests should succeed
      for (let i = 0; i < 5; i++) {
        const res = await request(testApp)
          .get('/api/paid-test')
          .set('X-Forwarded-For', clientIp);
        expect(res.status).toBe(200);
      }

      // 6th request exceeds limit and must return 429
      const overflowRes = await request(testApp)
        .get('/api/paid-test')
        .set('X-Forwarded-For', clientIp);

      expect(overflowRes.status).toBe(429);
      expect(overflowRes.body).toHaveProperty(
        'error',
        'Too many requests, please try again later.'
      );
    });
  });

  describe('Test 3: Independent Client IP Tracking via Trust Proxy', () => {
    it('tracks rate limits independently for different client IPs via X-Forwarded-For', async () => {
      const testApp = express();
      testApp.set('trust proxy', 1);

      testApp.use(
        '/api/paid-isolated',
        rateLimiter(3, 60000),
        (_req, res) => res.json({ success: true })
      );

      const clientA = '203.0.113.1';
      const clientB = '203.0.113.2';

      // Client A exhausts its 3 requests limit
      for (let i = 0; i < 3; i++) {
        const res = await request(testApp)
          .get('/api/paid-isolated')
          .set('X-Forwarded-For', clientA);
        expect(res.status).toBe(200);
      }

      // Client A's 4th request gets 429
      const clientABlocked = await request(testApp)
        .get('/api/paid-isolated')
        .set('X-Forwarded-For', clientA);
      expect(clientABlocked.status).toBe(429);

      // Client B makes request and should NOT be rate limited (status 200)
      const clientBSuccess = await request(testApp)
        .get('/api/paid-isolated')
        .set('X-Forwarded-For', clientB);
      expect(clientBSuccess.status).toBe(200);
    });
  });
});
