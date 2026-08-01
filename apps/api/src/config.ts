import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z
    .string({
      required_error: 'MONGODB_URI is required',
    })
    .url('MONGODB_URI must be a valid connection URL'),
  REDIS_URL: z
    .string({
      required_error: 'REDIS_URL is required',
    })
    .url('REDIS_URL must be a valid connection URL'),
  SERP_API_KEY: z.string().default('mock-serp-key'),
  SERP_API_PROVIDER: z.string().default('mock-provider'),
  LLM_API_KEY: z.string().default('mock-llm-key'),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(2000),
  RATE_LIMIT_PAID_MAX: z.coerce.number().default(100),

  DATAFORSEO_LOGIN: z.string().default(''),
  DATAFORSEO_PASSWORD: z.string().default(''),

  GOOGLE_OAUTH_CLIENT_ID: z.string().default(''),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(''),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().default(''),
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().default(''),

  STORAGE_PATH: z.string().default('./data/reports'),

  DOWNLOAD_TOKEN_TTL_MS: z.coerce.number().default(3600000),

  NEO4J_URI: z.string().default('bolt://localhost:7687'),
  NEO4J_USER: z.string().default('neo4j'),
  NEO4J_PASSWORD: z.string().default('rankengine_password'),
  QDRANT_URL: z.string().default('http://localhost:6333'),
});

const parseEnv = () => {
  if (process.env.REDIS_URL && process.env.REDIS_URL.includes('localhost')) {
    process.env.REDIS_URL = process.env.REDIS_URL.replace('localhost', '127.0.0.1');
  }
  if (process.env.MONGODB_URI && process.env.MONGODB_URI.includes('localhost')) {
    process.env.MONGODB_URI = process.env.MONGODB_URI.replace('localhost', '127.0.0.1');
  }
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Environment validation failed. Please check your configuration:');
    result.error.issues.forEach((issue) => {
      console.error(`   - [${issue.path.join('.')}]: ${issue.message}`);
    });
    process.exit(1);
  }

  return result.data;
};

export const config = parseEnv();
export type Config = typeof config;
export default config;
