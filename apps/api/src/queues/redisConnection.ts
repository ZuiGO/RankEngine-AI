import { ConnectionOptions } from 'bullmq';
import { RedisOptions } from 'ioredis';
import config from '../config';

const url = new URL(config.REDIS_URL);

/** Shared Redis endpoint options for BullMQ and other API Redis consumers. */
export const redisOptions: RedisOptions = {
  host: url.hostname || '127.0.0.1',
  port: parseInt(url.port || '6379', 10),
  username: url.username || undefined,
  password: url.password || undefined,
  db: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : undefined,
};

export const redisConnection: ConnectionOptions = {
  ...redisOptions,
  maxRetriesPerRequest: null, // Required by BullMQ
};

export default redisConnection;
