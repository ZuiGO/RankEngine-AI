import axios from 'axios';
import config from '../config';
import User from '../models/User';
import KeywordDataCache from '../models/KeywordDataCache';
import BacklinkDataCache from '../models/BacklinkDataCache';
import DomainOverviewCache from '../models/DomainOverviewCache';

// ─── Public types ──────────────────────────────────────────────────────────

export interface KeywordData {
  searchVolume: number;
  difficulty: number;
  cpc: number;
  intent: string;
  relatedKeywords: string[];
}

export interface BacklinkOverview {
  totalBacklinks: number;
  referringDomains: number;
  domainRating: number;
}

export interface BacklinkItem {
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  firstSeen: string;
  spamScore: number;
}

export interface DomainOverview {
  organicTrafficEstimate: number;
  organicKeywordCount: number;
  topKeywords: string[];
}

export class DataProviderQuotaError extends Error {
  public retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'DataProviderQuotaError';
    this.retryAfterMs = retryAfterMs;
  }
}

// ─── Cache TTL constants (in milliseconds) ──────────────────────────────────

const CACHE_TTL: Record<string, number> = {
  keyword: 7 * 24 * 60 * 60 * 1000,
  ideas: 7 * 24 * 60 * 60 * 1000,
  backlink: 3 * 24 * 60 * 60 * 1000,
  domainOverview: 3 * 24 * 60 * 60 * 1000,
};

const DATAFORSEO_BASE = 'https://api.dataforseo.com';

// ─── Provider interface ─────────────────────────────────────────────────────

export interface IDataProvider {
  fetchKeywordData(keywords: string[], locationCode?: string): Promise<KeywordData[]>;
  fetchKeywordIdeas(keyword: string, locationCode?: string): Promise<KeywordData[]>;
  fetchBacklinkOverview(domain: string): Promise<BacklinkOverview>;
  fetchBacklinkList(domain: string, limit: number): Promise<BacklinkItem[]>;
  fetchDomainOverview(domain: string): Promise<DomainOverview>;
}

// ─── Mock provider (used when DataForSEO credentials are absent) ────────────

export class MockDataProvider implements IDataProvider {
  async fetchKeywordData(keywords: string[], _locationCode?: string): Promise<KeywordData[]> {
    return keywords.map((kw) => ({
      searchVolume: Math.floor(Math.random() * 5000) + 100,
      difficulty: Math.floor(Math.random() * 100),
      cpc: parseFloat((Math.random() * 10).toFixed(2)),
      intent: ['informational', 'commercial', 'transactional', 'navigational'][Math.floor(Math.random() * 4)],
      relatedKeywords: [
        `${kw} guide`,
        `${kw} tools`,
        `best ${kw}`,
        `${kw} software`,
        `${kw} examples`,
      ],
    }));
  }

  async fetchKeywordIdeas(keyword: string, _locationCode?: string): Promise<KeywordData[]> {
    const ideas: KeywordData[] = [];
    const modifiers = [
      'guide', 'tools', 'software', 'examples', 'best',
      'top', 'review', 'pricing', 'vs', 'benefits',
      'strategies', 'tips', 'trends', 'services', 'platforms',
      'case study', 'checklist', 'analytics', 'automation', 'optimization',
      'comparison', 'tutorial', 'course', 'certification', 'community',
      'agency', 'consultant', 'jobs', 'interview questions', 'for beginners',
    ];
    for (const mod of modifiers) {
      ideas.push({
        searchVolume: Math.floor(Math.random() * 5000) + 50,
        difficulty: Math.floor(Math.random() * 100),
        cpc: parseFloat((Math.random() * 10).toFixed(2)),
        intent: ['informational', 'commercial', 'transactional', 'navigational'][Math.floor(Math.random() * 4)],
        relatedKeywords: [],
      });
    }
    ideas.sort((a, b) => b.searchVolume - a.searchVolume);
    return ideas.slice(0, 30);
  }

  async fetchBacklinkOverview(domain: string): Promise<BacklinkOverview> {
    return {
      totalBacklinks: Math.floor(Math.random() * 50000) + 100,
      referringDomains: Math.floor(Math.random() * 2000) + 10,
      domainRating: Math.floor(Math.random() * 80) + 10,
    };
  }

  async fetchBacklinkList(domain: string, limit: number): Promise<BacklinkItem[]> {
    return Array.from({ length: Math.min(limit, 20) }, (_, i) => ({
      sourceUrl: `https://referrer-${i + 1}.com/article`,
      targetUrl: `https://${domain}/page`,
      anchorText: `anchor text ${i + 1}`,
      firstSeen: new Date(Date.now() - Math.random() * 365 * 86400000).toISOString().split('T')[0],
      spamScore: Math.floor(Math.random() * 100),
    }));
  }

  async fetchDomainOverview(domain: string): Promise<DomainOverview> {
    return {
      organicTrafficEstimate: Math.floor(Math.random() * 100000) + 1000,
      organicKeywordCount: Math.floor(Math.random() * 10000) + 100,
      topKeywords: [
        `${domain.split('.')[0]} seo`,
        `${domain.split('.')[0]} marketing`,
        `best ${domain.split('.')[0]} tools`,
      ],
    };
  }
}

// ─── Real DataForSEO provider ───────────────────────────────────────────────

export class DataForSEOProvider implements IDataProvider {
  private readonly authHeader: string;

  constructor() {
    this.authHeader = `Basic ${Buffer.from(`${config.DATAFORSEO_LOGIN}:${config.DATAFORSEO_PASSWORD}`).toString('base64')}`;
  }

  private async post<T>(path: string, body: unknown[]): Promise<T> {
    type DataForSEOTask = {
      result: T[];
      error?: { message: string; code: number };
    };
    const response = await axios.post<{ tasks: DataForSEOTask[] }>(
      `${DATAFORSEO_BASE}${path}`,
      body,
      {
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );
    const task = response.data.tasks?.[0];
    if (!task || task.error) {
      const msg = task?.error?.message ?? `DataForSEO ${path} returned no task`;
      throw new Error(msg);
    }
    return task.result?.[0];
  }

  async fetchKeywordData(keywords: string[], locationCode?: string): Promise<KeywordData[]> {
    const tasks = keywords.map((kw) => ({
      keyword: kw,
      location_code: locationCode ? Number(locationCode) : 2840,
      language_code: 'en',
    }));
    const response = await axios.post<{
      tasks: { result: { items: { keyword: string; search_volume: number; competition: number; cpc: number; keyword_intent: string; keyword_properties: { intent?: string } }[] }[] }[];
    }>(
      `${DATAFORSEO_BASE}/v3/keywords_data/google_ads/search_volume/live`,
      tasks,
      {
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );
    const result = response.data.tasks?.[0]?.result?.[0];
    if (!result) {
      throw new Error('DataForSEO keyword data returned no result');
    }
    return result.items.map((item) => ({
      searchVolume: item.search_volume ?? 0,
      difficulty: Math.round((item.competition ?? 0) * 100),
      cpc: item.cpc ?? 0,
      intent: item.keyword_properties?.intent ?? item.keyword_intent ?? '',
      relatedKeywords: [],
    }));
  }

  async fetchKeywordIdeas(keyword: string, locationCode?: string): Promise<KeywordData[]> {
    const response = await axios.post<{
      tasks: { result: { items: {
        keyword: string;
        search_volume: number;
        competition: number;
        cpc: number;
        keyword_intent: string;
        keyword_properties: { intent?: string };
      }[] }[] }[];
    }>(
      `${DATAFORSEO_BASE}/v3/dataforseo_labs/google/keyword_ideas/live`,
      [{
        keyword,
        location_code: locationCode ? Number(locationCode) : 2840,
        language_code: 'en',
        include_serp_info: false,
        limit: 30,
      }],
      {
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );
    const items = response.data.tasks?.[0]?.result?.[0]?.items ?? [];
    return items.map((item) => ({
      searchVolume: item.search_volume ?? 0,
      difficulty: Math.round((item.competition ?? 0) * 100),
      cpc: item.cpc ?? 0,
      intent: item.keyword_properties?.intent ?? item.keyword_intent ?? '',
      relatedKeywords: [],
    }));
  }

  async fetchBacklinkOverview(domain: string): Promise<BacklinkOverview> {
    const result = await this.post<{
      total_backlinks: number;
      referring_domains: number;
      domain_rating: number;
    }>('/v3/backlinks/summary/live', [
      { target: domain, include_subdomains: false },
    ]);
    return {
      totalBacklinks: result.total_backlinks ?? 0,
      referringDomains: result.referring_domains ?? 0,
      domainRating: result.domain_rating ?? 0,
    };
  }

  async fetchBacklinkList(domain: string, limit: number): Promise<BacklinkItem[]> {
    const response = await axios.post<{
      tasks: { result: { items: { source_url: string; target_url: string; anchor_text: string; first_seen: string; spam_score: number }[] }[] }[];
    }>(
      `${DATAFORSEO_BASE}/v3/backlinks/backlinks/live`,
      [{ target: domain, limit, offset: 0 }],
      {
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );
    const items = response.data.tasks?.[0]?.result?.[0]?.items ?? [];
    return items.map((item) => ({
      sourceUrl: item.source_url ?? '',
      targetUrl: item.target_url ?? '',
      anchorText: item.anchor_text ?? '',
      firstSeen: item.first_seen ?? '',
      spamScore: item.spam_score ?? 0,
    }));
  }

  async fetchDomainOverview(domain: string): Promise<DomainOverview> {
    const result = await this.post<{
      organic_traffic_estimate: number;
      organic_keywords_count: number;
      top_keywords: { keyword: string }[];
    }>('/v3/dataforseo_labs/google/domain_overview/live', [
      { target: domain, location_code: 2840, language_code: 'en' },
    ]);
    return {
      organicTrafficEstimate: result.organic_traffic_estimate ?? 0,
      organicKeywordCount: result.organic_keywords_count ?? 0,
      topKeywords: (result.top_keywords ?? []).map((k) => k.keyword),
    };
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export const getDataProvider = (): IDataProvider => {
  if (
    !config.DATAFORSEO_LOGIN ||
    !config.DATAFORSEO_PASSWORD ||
    config.DATAFORSEO_LOGIN === ''
  ) {
    return new MockDataProvider();
  }
  return new DataForSEOProvider();
};

// ─── Quota helpers ──────────────────────────────────────────────────────────

const DATAFORSEO_TASK_PRICES: Record<string, number> = {
  keyword: 1,
  ideas: 1,
  backlinkOverview: 1,
  backlinkList: 1,
  domainOverview: 1,
};

export const checkAndIncrementQuota = async (
  userId: string,
  operation: string,
  isCacheHit: boolean,
): Promise<void> => {
  if (isCacheHit) return;

  const cost = DATAFORSEO_TASK_PRICES[operation] ?? 1;
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const now = new Date();
  if (user.dataProviderQuotaResetAt <= now) {
    user.dataProviderCallsThisMonth = 0;
    user.dataProviderQuotaResetAt = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
  }

  if (user.dataProviderCallsThisMonth + cost > user.dataProviderMonthlyLimit) {
    const msUntilReset = user.dataProviderQuotaResetAt.getTime() - now.getTime();
    throw new DataProviderQuotaError(
      `Monthly data provider quota exceeded. Limit: ${user.dataProviderMonthlyLimit} calls. Resets ${user.dataProviderQuotaResetAt.toISOString().split('T')[0]}.`,
      msUntilReset > 0 ? msUntilReset : 86400000,
    );
  }

  user.dataProviderCallsThisMonth += cost;
  await user.save();
};

// ─── Cache helpers ──────────────────────────────────────────────────────────

const getDateBucket = (date: Date = new Date()): string => {
  return date.toISOString().split('T')[0];
};

const isCacheFresh = (cachedAt: Date, ttlMs: number): boolean => {
  return Date.now() - cachedAt.getTime() < ttlMs;
};

// ─── Public API functions ───────────────────────────────────────────────────

export const getKeywordData = async (
  userId: string,
  keyword: string,
  locationCode?: string,
): Promise<KeywordData> => {
  const now = new Date();
  const dateBucket = getDateBucket(now);
  const loc = locationCode ?? '';
  const cacheKey = `keyword:${keyword.toLowerCase().trim()}:${loc}`;

  const cached = await KeywordDataCache.findOne({ cacheKey, dateBucket });
  if (cached && isCacheFresh(cached.cachedAt, CACHE_TTL.keyword)) {
    return {
      searchVolume: cached.searchVolume,
      difficulty: cached.difficulty,
      cpc: cached.cpc,
      intent: cached.intent,
      relatedKeywords: cached.relatedKeywords,
    };
  }

  await checkAndIncrementQuota(userId, 'keyword', false);

  const provider = getDataProvider();
  const results = await provider.fetchKeywordData([keyword], locationCode);
  const data = results[0];

  if (!data) {
    throw new Error('No keyword data returned from provider');
  }

  await KeywordDataCache.findOneAndUpdate(
    { cacheKey, dateBucket },
    {
      cacheKey,
      dateBucket,
      keyword: keyword.toLowerCase().trim(),
      locationCode: loc,
      searchVolume: data.searchVolume,
      difficulty: data.difficulty,
      cpc: data.cpc,
      intent: data.intent,
      relatedKeywords: data.relatedKeywords,
      cachedAt: now,
    },
    { upsert: true, new: true },
  );

  return data;
};

export const getKeywordIdeas = async (
  userId: string,
  keyword: string,
  locationCode?: string,
): Promise<KeywordData[]> => {
  const now = new Date();
  const dateBucket = getDateBucket(now);
  const loc = locationCode ?? '';
  const cacheKey = `ideas:${keyword.toLowerCase().trim()}:${loc}`;

  const cached = await KeywordDataCache.findOne({ cacheKey, dateBucket });
  if (cached && isCacheFresh(cached.cachedAt, CACHE_TTL.ideas)) {
    return cached.relatedKeywords.length > 0
      ? JSON.parse(cached.relatedKeywords[0])
      : [];
  }

  await checkAndIncrementQuota(userId, 'ideas', false);

  const provider = getDataProvider();
  const data = await provider.fetchKeywordIdeas(keyword, locationCode);

  await KeywordDataCache.findOneAndUpdate(
    { cacheKey, dateBucket },
    {
      cacheKey,
      dateBucket,
      keyword: keyword.toLowerCase().trim(),
      locationCode: loc,
      searchVolume: 0,
      difficulty: 0,
      cpc: 0,
      intent: '',
      relatedKeywords: [JSON.stringify(data)],
      cachedAt: now,
    },
    { upsert: true, new: true },
  );

  return data;
};

export const getBacklinkOverview = async (
  userId: string,
  domain: string,
): Promise<BacklinkOverview> => {
  const now = new Date();
  const dateBucket = getDateBucket(now);
  const cacheKey = `bloverview:${domain.toLowerCase().trim()}`;

  const cached = await BacklinkDataCache.findOne({ cacheKey, dateBucket });
  if (cached && isCacheFresh(cached.cachedAt, CACHE_TTL.backlink)) {
    return {
      totalBacklinks: cached.totalBacklinks,
      referringDomains: cached.referringDomains,
      domainRating: cached.domainRating,
    };
  }

  await checkAndIncrementQuota(userId, 'backlinkOverview', false);

  const provider = getDataProvider();
  const data = await provider.fetchBacklinkOverview(domain);

  await BacklinkDataCache.findOneAndUpdate(
    { cacheKey, dateBucket },
    {
      cacheKey,
      dateBucket,
      domain: domain.toLowerCase().trim(),
      totalBacklinks: data.totalBacklinks,
      referringDomains: data.referringDomains,
      domainRating: data.domainRating,
      cachedAt: now,
    },
    { upsert: true, new: true },
  );

  return data;
};

export const getBacklinkList = async (
  userId: string,
  domain: string,
  limit: number = 100,
): Promise<BacklinkItem[]> => {
  const now = new Date();
  const dateBucket = getDateBucket(now);

  await checkAndIncrementQuota(userId, 'backlinkList', false);

  const provider = getDataProvider();
  const items = await provider.fetchBacklinkList(domain, limit);

  return items;
};

export const getDomainOverview = async (
  userId: string,
  domain: string,
): Promise<DomainOverview> => {
  const now = new Date();
  const dateBucket = getDateBucket(now);
  const cacheKey = `domainoverview:${domain.toLowerCase().trim()}`;

  const cached = await DomainOverviewCache.findOne({ cacheKey, dateBucket });
  if (cached && isCacheFresh(cached.cachedAt, CACHE_TTL.domainOverview)) {
    return {
      organicTrafficEstimate: cached.organicTrafficEstimate,
      organicKeywordCount: cached.organicKeywordCount,
      topKeywords: cached.topKeywords,
    };
  }

  await checkAndIncrementQuota(userId, 'domainOverview', false);

  const provider = getDataProvider();
  const data = await provider.fetchDomainOverview(domain);

  await DomainOverviewCache.findOneAndUpdate(
    { cacheKey, dateBucket },
    {
      cacheKey,
      dateBucket,
      domain: domain.toLowerCase().trim(),
      organicTrafficEstimate: data.organicTrafficEstimate,
      organicKeywordCount: data.organicKeywordCount,
      topKeywords: data.topKeywords,
      cachedAt: now,
    },
    { upsert: true, new: true },
  );

  return data;
};
