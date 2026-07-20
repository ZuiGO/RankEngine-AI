// Pre-populate environment variables before config.ts is imported to prevent validation failure.
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/rankengine_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_test_jwt_key_that_is_long_enough';
process.env.JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';
process.env.SERP_API_PROVIDER = 'mock';
process.env.SERP_API_KEY = 'mock-serp-key';
process.env.LLM_API_KEY = 'mock-llm-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';

import { _closeRedisClient } from '../src/middleware/rateLimiter';

afterAll(async () => {
  try {
    await _closeRedisClient();
  } catch (err) {
    console.error('Error closing Redis client in global afterAll:', err);
  }
});
