/**
 * HTTP request logger using morgan.
 *
 * Security rules:
 *  - The Authorization header is NEVER logged.
 *  - Request/response bodies are NOT logged (avoids capturing passwords or API keys).
 *  - In production the 'combined' Apache format is used (standard for log aggregators).
 *  - In development the concise 'dev' format is used for readability.
 *
 * morgan tokens included in 'combined':
 *   :remote-addr :remote-user :method :url HTTP/:http-version :status :res[content-length] :referrer :user-agent
 *
 * Notably ABSENT: Authorization, Cookie, request body.
 */

import morgan, { StreamOptions } from 'morgan';
import { Request, Response } from 'express';

// Write morgan output through console so it can be captured by whatever
// log aggregator wraps the process (e.g. PM2, Datadog, CloudWatch).
const stream: StreamOptions = {
  write: (message: string) => {
    // Strip any trailing newline — console.log adds its own
    process.stdout.write(message);
  },
};

// Skip logging in test environments or 304 (Not Modified) responses to avoid terminal log floods
const skip = (_req: Request, res: Response) =>
  process.env.NODE_ENV === 'test' || res.statusCode === 304;

/**
 * Returns a configured morgan middleware.
 * Use the 'combined' format in production for structured ingestion;
 * 'dev' in development for coloured, concise output.
 */
const format = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';

export const requestLogger = morgan(format, { stream, skip });
