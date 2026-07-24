import IORedis from 'ioredis';
import axios from 'axios';
import { PageSearchConsoleSnapshot } from '@rankengine/shared-types';
import { IProject } from '../models/Project';
import { getFreshAccessToken } from './googleTokenService';
import { redisOptions } from '../queues/redisConnection';

let cacheRedis: IORedis | null = null;

function getRedisClient(): IORedis | null {
  if (process.env.NODE_ENV === 'test') {
    return null; // Skip Redis in tests unless explicitly mocked
  }
  if (!cacheRedis) {
    cacheRedis = new IORedis({
      ...redisOptions,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    cacheRedis.on('error', (err) => {
      console.warn('[GSC Service] Redis cache error:', err.message);
    });
  }
  return cacheRedis;
}

export async function getPageMetrics(
  project: IProject,
  options: { startDate: string; endDate: string }
): Promise<Map<string, PageSearchConsoleSnapshot>> {
  const { startDate, endDate } = options;
  const projectId = project._id.toString();
  const gscSiteUrl = project.googleIntegration?.gscSiteUrl;

  if (!gscSiteUrl) {
    throw new Error('Search Console siteUrl is not configured on project googleIntegration');
  }

  const cacheKey = `gsc:${projectId}:${startDate}:${endDate}`;
  const redis = getRedisClient();

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const entries: [string, PageSearchConsoleSnapshot][] = JSON.parse(cached);
        return new Map(entries);
      }
    } catch (e) {
      console.warn('[GSC Service] Cache read failed:', e);
    }
  }

  const map = new Map<string, PageSearchConsoleSnapshot>();

  try {
    const accessToken = await getFreshAccessToken(project);
    const encodedSiteUrl = encodeURIComponent(gscSiteUrl);
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodedSiteUrl}/searchAnalytics/query`;

    const requestBody = {
      startDate,
      endDate,
      dimensions: ['page'],
      rowLimit: 5000,
    };

    const response = await axios.post<{
      rows?: Array<{
        keys?: string[];
        clicks?: number;
        impressions?: number;
        ctr?: number;
        position?: number;
      }>;
    }>(url, requestBody, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const data = response.data;

    if (data.rows && Array.isArray(data.rows)) {
      for (const row of data.rows) {
        const pageKey = row.keys?.[0] || '';
        if (!pageKey) continue;

        const snapshot: PageSearchConsoleSnapshot = {
          clicks: row.clicks || 0,
          impressions: row.impressions || 0,
          ctr: row.ctr || 0,
          avgPosition: row.position || 0,
        };

        // Store by raw URL/key
        map.set(pageKey, snapshot);

        // Also store by extracted path if pageKey is a full URL
        if (pageKey.startsWith('http://') || pageKey.startsWith('https://')) {
          try {
            const parsedPath = new URL(pageKey).pathname;
            if (!map.has(parsedPath)) {
              map.set(parsedPath, snapshot);
            }
          } catch {
            // Ignore URL parse errors
          }
        }
      }
    }
  } catch (err) {
    console.warn('[GSC Service] Could not fetch GSC metrics:', err instanceof Error ? err.message : err);
    return map;
  }

  if (redis) {
    try {
      const serialized = JSON.stringify(Array.from(map.entries()));
      await redis.setex(cacheKey, 86400, serialized); // 24h
    } catch (e) {
      console.warn('[GSC Service] Cache write failed:', e);
    }
  }

  return map;
}
