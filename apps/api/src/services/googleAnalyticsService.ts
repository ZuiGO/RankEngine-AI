import IORedis from 'ioredis';
import axios from 'axios';
import { PageAnalyticsSnapshot } from '@rankengine/shared-types';
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
      console.warn('[GA4 Service] Redis cache error:', err.message);
    });
  }
  return cacheRedis;
}

export async function getPageMetrics(
  project: IProject,
  options: { startDate: string; endDate: string }
): Promise<Map<string, PageAnalyticsSnapshot>> {
  const { startDate, endDate } = options;
  const projectId = project._id.toString();
  const gaPropertyId = project.googleIntegration?.gaPropertyId;

  if (!gaPropertyId) {
    throw new Error('GA4 Property ID is not configured on project googleIntegration');
  }

  const cacheKey = `ga:${projectId}:${startDate}:${endDate}`;
  const redis = getRedisClient();

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const entries: [string, PageAnalyticsSnapshot][] = JSON.parse(cached);
        return new Map(entries);
      }
    } catch (e) {
      console.warn('[GA4 Service] Cache read failed:', e);
    }
  }

  const map = new Map<string, PageAnalyticsSnapshot>();

  try {
    const accessToken = await getFreshAccessToken(project);
    const propertyPath = gaPropertyId.startsWith('properties/') ? gaPropertyId : `properties/${gaPropertyId}`;
    const url = `https://analyticsdata.googleapis.com/v1beta/${propertyPath}:runReport`;

    const requestBody = {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'sessions' },
        { name: 'engagementRate' },
        { name: 'averageSessionDuration' },
        { name: 'conversions' },
      ],
    };

    const response = await axios.post<{
      rows?: Array<{
        dimensionValues?: Array<{ value: string }>;
        metricValues?: Array<{ value: string }>;
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
        const path = row.dimensionValues?.[0]?.value || '/';
        const sessions = Number(row.metricValues?.[0]?.value || 0);
        const engagementRate = Number(row.metricValues?.[1]?.value || 0);
        const avgEngagementTimeSec = Number(row.metricValues?.[2]?.value || 0);
        const conversions = Number(row.metricValues?.[3]?.value || 0);

        map.set(path, {
          sessions,
          engagementRate,
          avgEngagementTimeSec,
          conversions,
        });
      }
    }
  } catch (err) {
    console.warn('[GA4 Service] Could not fetch GA4 metrics:', err instanceof Error ? err.message : err);
    return map;
  }

  if (redis) {
    try {
      const serialized = JSON.stringify(Array.from(map.entries()));
      await redis.setex(cacheKey, 86400, serialized); // 24h
    } catch (e) {
      console.warn('[GA4 Service] Cache write failed:', e);
    }
  }

  return map;
}
