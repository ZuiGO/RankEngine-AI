import { rateLimit, Store, Options, IncrementResponse, MemoryStore } from 'express-rate-limit';
import { Request, Response } from 'express';
import IORedis from 'ioredis';
import { redisOptions } from '../queues/redisConnection';

// ── Redis-backed sliding-window store ────────────────────────────────────────
class RedisRateLimitStore implements Store {
  private readonly client: IORedis;
  private windowMs: number = 0;
  private fallback: MemoryStore | null = null;

  constructor(client: IORedis) {
    this.client = client;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private getFallback(): MemoryStore {
    if (!this.fallback) {
      this.fallback = new MemoryStore();
    }
    return this.fallback;
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      const now = Date.now();
      const windowStart = now - this.windowMs;
      const redisKey = `rl:${key}`;
      const member = `${now}:${Math.random()}`;

      const pipeline = this.client.multi();
      pipeline.zremrangebyscore(redisKey, '-inf', windowStart);
      pipeline.zadd(redisKey, now, member);
      pipeline.zcard(redisKey);
      pipeline.zrange(redisKey, 0, 0, 'WITHSCORES');
      pipeline.pexpire(redisKey, this.windowMs);

      const results = await pipeline.exec();
      const totalHits = (results?.[2]?.[1] as number) ?? 1;
      const oldest = results?.[3]?.[1] as string[] | undefined;
      const oldestTimestamp = oldest?.[1] ? Number(oldest[1]) : now;
      const resetTime = new Date(oldestTimestamp + this.windowMs);

      return { totalHits, resetTime };
    } catch {
      return this.getFallback().increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      const oldest = await this.client.zrange(`rl:${key}`, 0, 0);
      if (oldest.length > 0) {
        await this.client.zrem(`rl:${key}`, oldest[0]);
      }
    } catch {
      this.getFallback().decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.client.del(`rl:${key}`);
    } catch {
      this.getFallback().resetKey(key);
    }
  }
}

let _redisClient: IORedis | null = null;

function getRedisClient(): IORedis {
  if (!_redisClient) {
    _redisClient = new IORedis({
      ...redisOptions,
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }
  return _redisClient;
}

import config from '../config';

export const rateLimiter = (limit: number, windowMs: number) => {
  const store = new RedisRateLimitStore(getRedisClient());

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req: Request) => req.ip || (req.headers['x-forwarded-for'] as string) || 'anonymous',
    message: {
      error: 'Too many requests, please try again later.',
    },
    handler: (req: Request, res: Response) => {
      const rateLimitRequest = req as Request & { rateLimit?: { resetTime?: Date } };
      const resetTime = rateLimitRequest.rateLimit?.resetTime?.getTime() ?? Date.now() + windowMs;
      res.status(429).json({
        error: 'Too many requests, please try again later.',
        retryAfterMs: Math.max(0, resetTime - Date.now()),
      });
    },
    validate: false,
    store,
  });
};

/**
 * Route-scoped rate limiter for paid external API routes (DataForSEO, SERP, heavy LLM ops).
 *
 * Math & Cost-Control Rationale for single-company internal deployment:
 *  - RankEngine AI is an internal single-company tool used by team members (~5-10 concurrent users).
 *  - Standard UI polling endpoints (GET /api/crawl-jobs/:id every 3s, GET /api/notifications, GET /api/projects)
 *    are NOT rate-limited by this middleware, ensuring UI responsiveness without false positives.
 *  - DataForSEO and SERP API calls incur per-request financial cost.
 *  - An active team member performing keyword research or competitor analysis triggers 5-10 paid calls per session.
 *  - 100 requests per 15-minute window per IP (RATE_LIMIT_PAID_MAX = 100) permits peak multi-tab research
 *    (~6.6 paid requests/minute per client IP) while capping total DataForSEO financial exposure and preventing
 *    accidental runaway script loops.
 */
export const paidApiRateLimiter = rateLimiter(
  config.RATE_LIMIT_PAID_MAX,
  config.RATE_LIMIT_WINDOW_MS
);

export const _closeRedisClient = async (): Promise<void> => {
  if (_redisClient) {
    await _redisClient.quit();
    _redisClient = null;
  }
};

export const _clearRateLimitStore = async (): Promise<void> => {
  const tempClient = new IORedis({
    ...redisOptions,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => undefined,
    enableReadyCheck: false,
    lazyConnect: false,
  });
  tempClient.on('error', () => {});
  try {
    const keys = await tempClient.keys('rl:*');
    if (keys.length > 0) {
      await tempClient.del(...keys);
    }
  } catch {
    // Redis may not be available; silently skip
  } finally {
    await tempClient.quit().catch(() => {});
  }
};
