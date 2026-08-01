import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import dns from 'dns';
import mongoose from 'mongoose';
import Redis from 'ioredis';
import config from './config';

dns.setDefaultResultOrder('ipv4first');

import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { paidApiRateLimiter } from './middleware/rateLimiter';

import projectsRouter from './routes/projects';
import crawlJobsRouter from './routes/crawlJobs';
import contentRouter from './routes/content';
import keywordsRouter from './routes/keywords';
import notificationsRouter from './routes/notifications';
import keywordResearchRouter from './routes/keywordResearch';
import backlinksRouter from './routes/backlinks';
import aiVisibilityRouter from './routes/aiVisibility';
import domainOverviewRouter from './routes/domainOverview';
import gapAnalysisRouter from './routes/gapAnalysis';
import reportsRouter from './routes/reports';
import contentWriterRouter from './routes/contentWriter';
import keywordClusteringRouter from './routes/keywordClustering';
import cwvRouter from './routes/cwv';
import internalLinksRouter from './routes/internalLinks';
import chatRouter from './routes/chat';
import googleIntegrationRouter from './routes/googleIntegration';
import siteReportRouter from './routes/siteReport';
import pendingChangesRouter from './routes/pendingChanges';
import graphRouter from './routes/graph';

const app = express();

// Configure trust proxy count matching single Nginx container reverse proxy topology
app.set('trust proxy', 1);

app.use(helmet());

const allowedOrigins = config.CORS_ORIGIN.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  })
);

app.use(requestLogger);
app.use(express.json({ limit: '1mb' }));

const storagePath = path.resolve(config.STORAGE_PATH);
app.use('/api/files', express.static(storagePath));

// ── Unthrottled UI & Polling Routes ───────────────────────────────────────────
// GET /api/crawl-jobs/:id is polled every 3 seconds by ProjectDetailPage.tsx
// GET /api/notifications is polled every 60 seconds by Layout.tsx
// These read endpoints must NOT be rate limited.
app.use('/api/projects', projectsRouter);
app.use('/api/projects', keywordsRouter);
app.use('/api/crawl-jobs', crawlJobsRouter);
app.use('/api/content', contentRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/projects', aiVisibilityRouter);
app.use('/api/projects', reportsRouter);
app.use('/api/projects', contentWriterRouter);
app.use('/api/projects', cwvRouter);
app.use('/api/projects', internalLinksRouter);
app.use('/api/projects', chatRouter);
app.use('/api/projects', siteReportRouter);
app.use('/api/projects', graphRouter);
app.use('/api', pendingChangesRouter);
app.use('/api', googleIntegrationRouter);

// ── Paid External API Routes (DataForSEO / SERP API / Heavy ops) ────────────
// Protected by route-scoped rate limiting (100 req / 15 min per IP)
app.use('/api', paidApiRateLimiter, keywordResearchRouter);
app.use('/api/projects', paidApiRateLimiter, backlinksRouter);
app.use('/api/projects', paidApiRateLimiter, domainOverviewRouter);
app.use('/api/projects', paidApiRateLimiter, gapAnalysisRouter);
app.use('/api/projects', paidApiRateLimiter, keywordClusteringRouter);

// Dynamically load queue listeners only when not running unit tests
if (process.env.NODE_ENV !== 'test') {
  import('./queues/crawlQueueEvents')
    .then(() => console.log('[QueueEvents]: Crawl QueueEvents listener loaded.'))
    .catch((err) => console.error('[QueueEvents]: Failed to load QueueEvents:', err));
}

// Health check — actually pings MongoDB and Redis
app.get('/health', async (_req, res) => {
  let dbStatus = 'disconnected';
  let redisStatus = 'disconnected';

  try {
    const db = mongoose.connection.db;
    if (db) {
      await db.admin().command({ ping: 1 });
      dbStatus = 'connected';
    }
  } catch {
    dbStatus = 'disconnected';
  }

  let testRedis: Redis | null = null;
  try {
    testRedis = new Redis(config.REDIS_URL, { lazyConnect: true });
    await testRedis.connect();
    await testRedis.ping();
    redisStatus = 'connected';
  } catch {
    redisStatus = 'disconnected';
  } finally {
    if (testRedis) {
      testRedis.disconnect();
    }
  }

  const overall = dbStatus === 'connected' && redisStatus === 'connected' ? 'ok' : 'error';

  res.json({
    status: overall,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: dbStatus,
      redis: redisStatus,
    },
  });
});

app.use(errorHandler);

export default app;
export { app };
