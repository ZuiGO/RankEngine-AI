// Pre-populate environment variables before config.ts is imported to prevent validation failure.
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/rankengine_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.SERP_API_PROVIDER = 'mock';
process.env.SERP_API_KEY = 'mock-serp-key';
process.env.LLM_API_KEY = 'mock-llm-key';

import { _closeRedisClient } from '../src/middleware/rateLimiter';

afterAll(async () => {
  try {
    await _closeRedisClient();
  } catch (err) {
    console.error('Error closing Redis client in global afterAll:', err);
  }
});
