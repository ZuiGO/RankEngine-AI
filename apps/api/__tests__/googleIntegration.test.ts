import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';
import express from 'express';
import axios from 'axios';

// Mock BullMQ to prevent tests from requiring live Redis
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

import app from '../src/app';
import Project from '../src/models/Project';
import {
  encryptToken,
  decryptToken,
  getFreshAccessToken,
} from '../src/services/googleTokenService';
import {
  signOAuthState,
  verifyOAuthState,
} from '../src/routes/googleIntegration';
import { getPageMetrics as getGaPageMetrics } from '../src/services/googleAnalyticsService';
import { getPageMetrics as getGscPageMetrics } from '../src/services/searchConsoleService';
import { paidApiRateLimiter, _clearRateLimitStore } from '../src/middleware/rateLimiter';

const request = supertest(app);
let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Project.deleteMany({});
  await _clearRateLimitStore();
  jest.restoreAllMocks();
});

describe('Google Integration Service & Routes', () => {
  describe('OAuth State Signing & Verification', () => {
    it('successfully verifies a valid signed state', () => {
      const projectId = new mongoose.Types.ObjectId().toString();
      const signedState = signOAuthState(projectId);

      const result = verifyOAuthState(signedState);
      expect(result).not.toBeNull();
      expect(result?.projectId).toBe(projectId);
    });

    it('rejects a tampered or invalid state parameter', () => {
      const projectId = new mongoose.Types.ObjectId().toString();
      const signedState = signOAuthState(projectId);

      // Tamper with the state string
      const tamperedState = signedState.replace(projectId, '507f1f77bcf86cd799439011');
      expect(verifyOAuthState(tamperedState)).toBeNull();

      expect(verifyOAuthState('invalid.state')).toBeNull();
      expect(verifyOAuthState('')).toBeNull();
    });
  });

  describe('Token Encryption & Decryption', () => {
    it('encrypts and decrypts refresh token correctly (round-trip)', () => {
      const rawToken = '1//04_example_refresh_token_secret_12345';
      const encrypted = encryptToken(rawToken);

      expect(encrypted).not.toBe(rawToken);
      expect(encrypted).toContain(':'); // Contains iv:authTag:cipherText

      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(rawToken);
    });

    it('throws error when decrypting invalid or tampered encrypted token', () => {
      expect(() => decryptToken('invalid-format')).toThrow('Invalid encrypted token format');
    });
  });

  describe('GET /api/integrations/google/connect', () => {
    it('redirects to Google OAuth consent screen with signed state when valid projectId provided', async () => {
      const project = await Project.create({
        name: 'Connect Test Project',
        domain: 'https://connecttest.com',
      });

      const res = await request.get(`/api/integrations/google/connect?projectId=${project._id}`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('accounts.google.com/o/oauth2/v2/auth');
      expect(res.headers.location).toContain(`state=`);
    });

    it('returns 400 when missing or invalid projectId parameter', async () => {
      const res = await request.get('/api/integrations/google/connect?projectId=invalid-id');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Valid projectId query parameter is required');
    });
  });

  describe('GET /api/projects/:id/integrations/google/status', () => {
    it('returns connected: false for a project with no googleIntegration', async () => {
      const project = await Project.create({
        name: 'Test Unconnected Project',
        domain: 'https://example.com',
      });

      const res = await request.get(`/api/projects/${project._id}/integrations/google/status`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        connected: false,
      });
      expect(res.body).not.toHaveProperty('encryptedRefreshToken');
    });

    it('returns connected: true and integration details, never leaking encryptedRefreshToken', async () => {
      const encryptedToken = encryptToken('sample-refresh-token');
      const project = await Project.create({
        name: 'Test Connected Project',
        domain: 'https://example.com',
        googleIntegration: {
          gaPropertyId: '123456789',
          gscSiteUrl: 'https://example.com/',
          encryptedRefreshToken: encryptedToken,
          scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
          connectedAt: new Date(),
        },
      });

      const res = await request.get(`/api/projects/${project._id}/integrations/google/status`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        connected: true,
        gaPropertyId: '123456789',
        gscSiteUrl: 'https://example.com/',
        scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
      });

      // MUST NEVER leak encryptedRefreshToken in response body
      expect(res.body).not.toHaveProperty('encryptedRefreshToken');
      expect(JSON.stringify(res.body)).not.toContain('sample-refresh-token');
      expect(JSON.stringify(res.body)).not.toContain(encryptedToken);
    });
  });

  describe('Rate Limiting on Data-Fetch Google Routes', () => {
    it('applies paidApiRateLimiter to Google integration data-fetching endpoints', async () => {
      const testApp = express();
      testApp.set('trust proxy', 1);
      testApp.use(express.json());

      testApp.patch(
        '/api/projects/:id/integrations/google',
        paidApiRateLimiter,
        (_req, res) => res.json({ success: true })
      );

      const clientIp = '203.0.113.50';
      const validId = new mongoose.Types.ObjectId().toString();

      // Make 100 requests (the default limit) in parallel
      await Promise.all(
        Array.from({ length: 100 }).map(() =>
          supertest(testApp)
            .patch(`/api/projects/${validId}/integrations/google`)
            .set('X-Forwarded-For', clientIp)
            .send({ gaPropertyId: '9999' })
        )
      );

      // 101st request exceeds rate limit and must return 429
      const rateLimitedRes = await supertest(testApp)
        .patch(`/api/projects/${validId}/integrations/google`)
        .set('X-Forwarded-For', clientIp)
        .send({ gaPropertyId: '9999' });

      expect(rateLimitedRes.status).toBe(429);
      expect(rateLimitedRes.body).toHaveProperty(
        'error',
        'Too many requests, please try again later.'
      );
    }, 15000);
  });

  describe('Google Token & Metrics Services (Mocked Outbound Calls)', () => {
    it('getFreshAccessToken exchanges refresh token via mocked axios', async () => {
      const encryptedToken = encryptToken('mock-refresh-token-val');
      const project = await Project.create({
        name: 'Token Test Project',
        domain: 'https://test.org',
        googleIntegration: {
          encryptedRefreshToken: encryptedToken,
        },
      });

      jest.spyOn(axios, 'post').mockImplementation(async (url) => {
        if (String(url).includes('oauth2.googleapis.com/token')) {
          return { data: { access_token: 'fresh-mock-access-token-123' }, status: 200 } as any;
        }
        throw new Error('Not found');
      });

      const accessToken = await getFreshAccessToken(project);
      expect(accessToken).toBe('fresh-mock-access-token-123');
    });

    it('googleAnalyticsService.getPageMetrics fetches and maps GA4 page metrics', async () => {
      const encryptedToken = encryptToken('ga-refresh-token');
      const project = await Project.create({
        name: 'GA4 Test Project',
        domain: 'https://ga4test.com',
        googleIntegration: {
          gaPropertyId: '987654321',
          encryptedRefreshToken: encryptedToken,
        },
      });

      jest.spyOn(axios, 'post').mockImplementation(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return { data: { access_token: 'mock-ga-access-token' }, status: 200 } as any;
        }
        if (urlStr.includes('analyticsdata.googleapis.com')) {
          return {
            data: {
              rows: [
                {
                  dimensionValues: [{ value: '/home' }],
                  metricValues: [
                    { value: '150' },   // sessions
                    { value: '0.65' },  // engagementRate
                    { value: '45.2' },  // averageSessionDuration
                    { value: '12' },    // conversions
                  ],
                },
              ],
            },
            status: 200,
          } as any;
        }
        throw new Error('Not found');
      });

      const metricsMap = await getGaPageMetrics(project, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });

      expect(metricsMap.has('/home')).toBe(true);
      const homeMetrics = metricsMap.get('/home');
      expect(homeMetrics).toEqual({
        sessions: 150,
        engagementRate: 0.65,
        avgEngagementTimeSec: 45.2,
        conversions: 12,
      });
    });

    it('searchConsoleService.getPageMetrics fetches and maps GSC page metrics', async () => {
      const encryptedToken = encryptToken('gsc-refresh-token');
      const project = await Project.create({
        name: 'GSC Test Project',
        domain: 'https://gsctest.com',
        googleIntegration: {
          gscSiteUrl: 'https://gsctest.com/',
          encryptedRefreshToken: encryptedToken,
        },
      });

      jest.spyOn(axios, 'post').mockImplementation(async (url) => {
        const urlStr = String(url);
        if (urlStr.includes('oauth2.googleapis.com/token')) {
          return { data: { access_token: 'mock-gsc-access-token' }, status: 200 } as any;
        }
        if (urlStr.includes('webmasters/v3/sites')) {
          return {
            data: {
              rows: [
                {
                  keys: ['https://gsctest.com/blog/seo'],
                  clicks: 420,
                  impressions: 5000,
                  ctr: 0.084,
                  position: 3.2,
                },
              ],
            },
            status: 200,
          } as any;
        }
        throw new Error('Not found');
      });

      const metricsMap = await getGscPageMetrics(project, {
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });

      expect(metricsMap.has('https://gsctest.com/blog/seo')).toBe(true);
      expect(metricsMap.has('/blog/seo')).toBe(true);

      const gscMetrics = metricsMap.get('/blog/seo');
      expect(gscMetrics).toEqual({
        clicks: 420,
        impressions: 5000,
        ctr: 0.084,
        avgPosition: 3.2,
      });
    });
  });
});
