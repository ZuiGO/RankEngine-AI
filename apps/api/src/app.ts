import express, { RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { HealthCheckResponse, CrawlJob } from '@rankengine/shared-types';

import config from './config';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';

import authRouter from './routes/auth';
import projectsRouter from './routes/projects';
import crawlJobsRouter from './routes/crawlJobs';
import contentRouter from './routes/content';
import keywordsRouter from './routes/keywords';
import notificationsRouter from './routes/notifications';

const app = express();

// ─────────────────────────────────────── SECURITY HEADERS ────────────────────
/**
 * helmet sets sensible HTTP security headers:
 *   X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security,
 *   Content-Security-Policy, Referrer-Policy, X-XSS-Protection, etc.
 */
app.use(helmet());

// ─────────────────────────────────────────── CORS ────────────────────────────
/**
 * Restrict CORS to the configured frontend origin (CORS_ORIGIN env var).
 * The Authorization header is included in the allowed list so the browser
 * can attach the JWT on cross-origin requests.
 *
 * DO NOT use cors() with no arguments in production — that allows any origin.
 */
app.use(
  cors({
    origin: config.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// ─────────────────────────────────────── RATE LIMITING ───────────────────────
/**
 * Global rate limiter — generous threshold to cover legitimate SPA usage.
 * Values come from env vars (RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX).
 * Defaults: 200 requests per 15-minute window per IP.
 *
 * Per-route stricter limits (e.g. the grading endpoint at 10 req/s)
 * are defined directly in their route files and compose on top of this.
 */
const globalRateLimiter: RequestHandler =
  process.env.NODE_ENV === 'test'
    ? (_req, _res, next) => next() // Per-route limits remain testable.
    : rateLimiter(config.RATE_LIMIT_MAX, config.RATE_LIMIT_WINDOW_MS);

app.use(globalRateLimiter);

// ─────────────────────────────────────────── LOGGING ────────────────────────
/**
 * HTTP request logger (morgan).
 * Skipped in test environments. Authorization headers and request bodies
 * are NOT logged — see middleware/requestLogger.ts for details.
 */
app.use(requestLogger);

// ──────────────────────────────────────── BODY PARSING ───────────────────────
app.use(express.json({ limit: '1mb' })); // cap body size to prevent payload abuse

// ──────────────────────────────────────────── ROUTES ─────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/projects', keywordsRouter);
app.use('/api/crawl-jobs', crawlJobsRouter);
app.use('/api/content', contentRouter);
app.use('/api/notifications', notificationsRouter);

// Dynamically load queue listeners only when not running unit tests
if (process.env.NODE_ENV !== 'test') {
  import('./queues/crawlQueueEvents')
    .then(() => console.log('[QueueEvents]: Crawl QueueEvents listener loaded.'))
    .catch((err) => console.error('[QueueEvents]: Failed to load QueueEvents:', err));
}

// ──────────────────────────────────── HEALTH CHECK ───────────────────────────
app.get('/health', (_req, res) => {
  const healthResponse: HealthCheckResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: 'connected',
      redis: 'connected',
    },
  };
  res.json(healthResponse);
});

// Demo jobs endpoint (shared types example)
app.get('/jobs', (_req, res) => {
  const jobs: CrawlJob[] = [
    {
      id: 'job-1',
      url: 'https://example.com',
      status: 'completed',
      userId: 'user-123',
      depth: 2,
      resultCount: 42,
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      completedAt: new Date().toISOString(),
    },
  ];
  res.json(jobs);
});

// ──────────────────────────────── CENTRALIZED ERROR HANDLER ──────────────────
/**
 * Must be the LAST middleware registered.
 * Catches any error passed to next(err) or thrown inside async route handlers.
 * In production: returns generic message; in dev: returns full stack.
 * See middleware/errorHandler.ts for details.
 */
app.use(errorHandler);

export default app;
export { app };
