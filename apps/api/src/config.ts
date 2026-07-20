import dotenv from 'dotenv';
import { z } from 'zod';

// Load variables from .env file into process.env
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
  JWT_SECRET: z
    .string({
      required_error: 'JWT_SECRET is required',
    })
    .min(8, 'JWT_SECRET must be at least 8 characters long'),
  JWT_EXPIRY: z.string({
    required_error: 'JWT_EXPIRY is required',
  }),
  SERP_API_KEY: z.string().default('mock-serp-key'),
  SERP_API_PROVIDER: z.string().default('mock-provider'),
  LLM_API_KEY: z.string().default('mock-llm-key'),

  /**
   * 32-byte AES-256 key expressed as 64 hex characters.
   * Used by src/utils/encryption.ts to encrypt sensitive fields at rest
   * (e.g. staging credentials, stored API keys).
   *
   * Generate with:
   *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   *
   * Defaults to a development-only placeholder when NODE_ENV !== 'production'.
   * In production this MUST be set to a cryptographically random value.
   */
  ENCRYPTION_KEY: z
    .string()
    .length(64, 'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)')
    .default('0000000000000000000000000000000000000000000000000000000000000000'),

  /**
   * Allowed CORS origin for the frontend.  Set to your Vite dev URL locally
   * and to your production domain in CI/production.
   * Example: http://localhost:5173  or  https://app.rankengine.io
   */
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  /** Global rate-limit window in milliseconds (default: 15 minutes) */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  /** Global rate-limit max requests per window per IP (default: 200) */
  RATE_LIMIT_MAX: z.coerce.number().default(200),

  /** DataForSEO API credentials for external SEO data (Keyword Research, Backlinks, Domain Overview) */
  DATAFORSEO_LOGIN: z.string().default(''),
  DATAFORSEO_PASSWORD: z.string().default(''),

  /** Per-user monthly quota for external data-provider API calls (excluding cache hits) */
  DATAFORSEO_MONTHLY_LIMIT: z.coerce.number().default(500),

  /** Stripe secret key (sk_test_... or sk_live_...) */
  STRIPE_SECRET_KEY: z.string().default('sk_test_mock'),
  /** Stripe webhook signing secret (whsec_...) */
  STRIPE_WEBHOOK_SECRET: z.string().default('whsec_mock'),

  /** Stripe price IDs for each paid plan */
  STRIPE_PRICE_PRO: z.string().default(''),
  STRIPE_PRICE_AGENCY: z.string().default(''),

  /** Local filesystem path for generated report PDFs (also used by storage service) */
  STORAGE_PATH: z.string().default('./data/reports'),

  /** Lifetime of signed download tokens in milliseconds (default: 1 hour) */
  DOWNLOAD_TOKEN_TTL_MS: z.coerce.number().default(3600000),
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
    console.error('❌ Environment validation failed. Please check your configuration:');
    result.error.issues.forEach((issue) => {
      console.error(`   - [${issue.path.join('.')}]: ${issue.message}`);
    });
    process.exit(1);
  }

  // Warn loudly if the encryption key is the dev placeholder in production
  if (
    result.data.NODE_ENV === 'production' &&
    result.data.ENCRYPTION_KEY ===
      '0000000000000000000000000000000000000000000000000000000000000000'
  ) {
    console.error(
      '❌ ENCRYPTION_KEY is using the default placeholder in production. This is insecure. Set a real key.'
    );
    process.exit(1);
  }

  return result.data;
};

export const config = parseEnv();
export type Config = typeof config;
export default config;
