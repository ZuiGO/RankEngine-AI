import express, { RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import mongoose from 'mongoose';
import Redis from 'ioredis';
import config from './config';

import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';

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

const app = express();

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

const globalRateLimiter: RequestHandler =
  process.env.NODE_ENV === 'test'
    ? (_req, _res, next) => next()
    : rateLimiter(config.RATE_LIMIT_MAX, config.RATE_LIMIT_WINDOW_MS);

app.use(globalRateLimiter);

app.use(requestLogger);

app.use(express.json({ limit: '1mb' }));

const storagePath = path.resolve(config.STORAGE_PATH);
app.use('/api/files', express.static(storagePath));

// Routes
app.use('/api/projects', projectsRouter);
app.use('/api/projects', keywordsRouter);
app.use('/api/crawl-jobs', crawlJobsRouter);
app.use('/api/content', contentRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api', keywordResearchRouter);
app.use('/api/projects', backlinksRouter);
app.use('/api/projects', aiVisibilityRouter);
app.use('/api/projects', domainOverviewRouter);
app.use('/api/projects', gapAnalysisRouter);
app.use('/api/projects', reportsRouter);

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
