import { rateLimit, Store, Options, IncrementResponse } from 'express-rate-limit';
import { Request, Response } from 'express';
import IORedis from 'ioredis';
import { redisOptions } from '../queues/redisConnection';

// ── Redis-backed sliding-window store ────────────────────────────────────────
// Uses a single sorted-set per key: members are random tokens, scores are
// timestamps (ms). Expired members are pruned on every increment so the set
// stays small without a separate TTL job.
class RedisRateLimitStore implements Store {
  private readonly client: IORedis;
  private windowMs: number = 0;

  constructor(client: IORedis) {
    this.client = client;
  }

  // Called by express-rate-limit during middleware construction
  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const redisKey = `rl:${key}`;
    const member = `${now}:${Math.random()}`;

    // MULTI/EXEC keeps each window update atomic when several API replicas
    // increment the same key at once.
    const pipeline = this.client.multi();
    // Remove timestamps outside the current window
    pipeline.zremrangebyscore(redisKey, '-inf', windowStart);
    // Add current timestamp
    pipeline.zadd(redisKey, now, member);
    // Count remaining members (= requests in window)
    pipeline.zcard(redisKey);
    // The oldest surviving request determines the next retry time.
    pipeline.zrange(redisKey, 0, 0, 'WITHSCORES');
    // Ensure the key expires after the window so Redis self-cleans idle entries
    pipeline.pexpire(redisKey, this.windowMs);

    const results = await pipeline.exec();
    // zcard result is at index 2 in the transaction.
    const totalHits = (results?.[2]?.[1] as number) ?? 1;
    const oldest = results?.[3]?.[1] as string[] | undefined;
    const oldestTimestamp = oldest?.[1] ? Number(oldest[1]) : now;
    const resetTime = new Date(oldestTimestamp + this.windowMs);

    return { totalHits, resetTime };
  }

  async decrement(key: string): Promise<void> {
    // Remove the oldest entry for this key (best-effort)
    const redisKey = `rl:${key}`;
    const oldest = await this.client.zrange(redisKey, 0, 0);
    if (oldest.length > 0) {
      await this.client.zrem(redisKey, oldest[0]);
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.client.del(`rl:${key}`);
  }
}

// ── Shared Redis client for rate limiting ─────────────────────────────────────
// Re-use a single connection so we don't exhaust the Redis pool.
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

/**
 * Returns an express-rate-limit middleware backed by Redis.
 * Rate-limiting state is shared across all API replicas.
 *
 * @param limit      Maximum number of requests allowed per window
 * @param windowMs   Window length in milliseconds
 */
export const rateLimiter = (limit: number, windowMs: number) => {
  const store = new RedisRateLimitStore(getRedisClient());

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Identify by authenticated userId or fall back to IP
    keyGenerator: (req: Request) => req.user?.userId ?? req.ip ?? 'anonymous',
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
    // Completely disable express-rate-limit internal validations to prevent test crashes
    validate: false,
    store,
  });
};

/** Close the Redis connection used by the rate limiter (needed for clean test teardowns). */
export const _closeRedisClient = async (): Promise<void> => {
  if (_redisClient) {
    await _redisClient.quit();
    _redisClient = null;
  }
};

/** Exposed only for unit tests – clears all rate-limit keys in Redis. */
export const _clearRateLimitStore = async (): Promise<void> => {
  const client = getRedisClient();
  const keys = await client.keys('rl:*');
  if (keys.length > 0) {
    await client.del(...keys);
  }
};
