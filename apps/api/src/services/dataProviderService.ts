import axios from 'axios';
import config from '../config';
import KeywordDataCache from '../models/KeywordDataCache';
import BacklinkDataCache from '../models/BacklinkDataCache';
import DomainOverviewCache from '../models/DomainOverviewCache';

export interface KeywordData {
  keyword?: string;
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

export interface TopKeyword {
  keyword: string;
  searchVolume?: number;
  position?: number;
}

export interface DomainOverview {
  organicTrafficEstimate: number;
  organicKeywordCount: number;
  topKeywords: TopKeyword[];
}

export class DataProviderQuotaError extends Error {
  public retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'DataProviderQuotaError';
    this.retryAfterMs = retryAfterMs;
  }
}

const CACHE_TTL: Record<string, number> = {
  keyword: 7 * 24 * 60 * 60 * 1000,
  ideas: 7 * 24 * 60 * 60 * 1000,
  backlink: 3 * 24 * 60 * 60 * 1000,
  domainOverview: 3 * 24 * 60 * 60 * 1000,
};

const DATAFORSEO_BASE = 'https://api.dataforseo.com';

export interface IDataProvider {
  fetchKeywordData(keywords: string[], locationCode?: string): Promise<KeywordData[]>;
  fetchKeywordIdeas(keyword: string, locationCode?: string): Promise<KeywordData[]>;
  fetchBacklinkOverview(domain: string): Promise<BacklinkOverview>;
  fetchBacklinkList(domain: string, limit: number, offset: number): Promise<BacklinkItem[]>;
  fetchReferringDomains(domain: string): Promise<string[]>;
  fetchDomainOverview(domain: string): Promise<DomainOverview>;
}

export class MockDataProvider implements IDataProvider {
  async fetchKeywordData(keywords: string[], _locationCode?: string): Promise<KeywordData[]> {
    return keywords.map((kw) => ({
      keyword: kw,
      searchVolume: Math.floor(Math.random() * 5000) + 100,
      difficulty: Math.floor(Math.random() * 100),
      cpc: parseFloat((Math.random() * 10).toFixed(2)),
      intent: ['informational', 'commercial', 'transactional', 'navigational'][
        Math.floor(Math.random() * 4)
      ],
      relatedKeywords: [
        `${kw} guide`, `${kw} tools`, `best ${kw}`,
        `${kw} software`, `${kw} examples`,
      ],
    }));
  }

  async fetchKeywordIdeas(keyword: string, _locationCode?: string): Promise<KeywordData[]> {
    const ideas: KeywordData[] = [];
    const modifiers = [
      'guide', 'tools', 'software', 'examples', 'best', 'top', 'review',
      'pricing', 'vs', 'benefits', 'strategies', 'tips', 'trends', 'services',
      'platforms', 'case study', 'checklist', 'analytics', 'automation',
      'optimization', 'comparison', 'tutorial', 'course', 'certification',
      'community', 'agency', 'consultant', 'jobs', 'interview questions', 'for beginners',
    ];
    for (const mod of modifiers) {
      ideas.push({
        keyword: `${keyword} ${mod}`,
        searchVolume: Math.floor(Math.random() * 5000) + 50,
        difficulty: Math.floor(Math.random() * 100),
        cpc: parseFloat((Math.random() * 10).toFixed(2)),
        intent: ['informational', 'commercial', 'transactional', 'navigational'][
          Math.floor(Math.random() * 4)
        ],
        relatedKeywords: [],
      });
    }
    ideas.sort((a, b) => b.searchVolume - a.searchVolume);
    return ideas.slice(0, 30);
  }

  async fetchBacklinkOverview(_domain: string): Promise<BacklinkOverview> {
    return {
      totalBacklinks: Math.floor(Math.random() * 50000) + 100,
      referringDomains: Math.floor(Math.random() * 2000) + 10,
      domainRating: Math.floor(Math.random() * 80) + 10,
    };
  }

  async fetchBacklinkList(domain: string, limit: number, offset: number = 0): Promise<BacklinkItem[]> {
    const count = Math.min(limit, 20);
    return Array.from({ length: count }, (_, i) => ({
      sourceUrl: `https://referrer-${offset + i + 1}.com/article`,
      targetUrl: `https://${domain}/page`,
      anchorText: `anchor text ${offset + i + 1}`,
      firstSeen: new Date(Date.now() - Math.random() * 365 * 86400000).toISOString().split('T')[0],
      spamScore: Math.floor(Math.random() * 100),
    }));
  }

  async fetchReferringDomains(_domain: string): Promise<string[]> {
    const prefixes = ['blog', 'news', 'forum', 'links', 'resources', 'support', 'community'];
    const tlds = ['.com', '.org', '.io', '.net', '.co', '.dev'];
    const count = Math.floor(Math.random() * 15) + 10;
    const domains = new Set<string>();
    for (let i = 0; i < count; i++) {
      const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
      const tld = tlds[Math.floor(Math.random() * tlds.length)];
      domains.add(`${prefix}-${Math.random().toString(36).slice(2, 6)}${tld}`);
    }
    return Array.from(domains);
  }

  async fetchDomainOverview(domain: string): Promise<DomainOverview> {
    const base = domain.split('.')[0];
    return {
      organicTrafficEstimate: Math.floor(Math.random() * 100000) + 1000,
      organicKeywordCount: Math.floor(Math.random() * 10000) + 100,
      topKeywords: [
        { keyword: `${base} seo`, searchVolume: Math.floor(Math.random() * 5000) + 200, position: Math.floor(Math.random() * 20) + 1 },
        { keyword: `${base} marketing`, searchVolume: Math.floor(Math.random() * 4000) + 150, position: Math.floor(Math.random() * 20) + 1 },
        { keyword: `best ${base} tools`, searchVolume: Math.floor(Math.random() * 3000) + 100, position: Math.floor(Math.random() * 30) + 1 },
        { keyword: `${base} pricing`, searchVolume: Math.floor(Math.random() * 2000) + 50, position: Math.floor(Math.random() * 40) + 1 },
        { keyword: `${base} vs`, searchVolume: Math.floor(Math.random() * 1500) + 30, position: Math.floor(Math.random() * 50) + 1 },
      ],
    };
  }
}

export class DataForSEOProvider implements IDataProvider {
  private readonly authHeader: string;

  constructor() {
    this.authHeader = `Basic ${Buffer.from(`${config.DATAFORSEO_LOGIN}:${config.DATAFORSEO_PASSWORD}`).toString('base64')}`;
  }

  private async post<T>(path: string, body: unknown[]): Promise<T> {
    type DataForSEOTask = { result: T[]; error?: { message: string; code: number } };
    const response = await axios.post<{ tasks: DataForSEOTask[] }>(
      `${DATAFORSEO_BASE}${path}`, body,
      { headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' }, timeout: 30000 }
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
    const response = await axios.post<{ tasks: { result: { items: { keyword: string; search_volume: number; competition: number; cpc: number; keyword_intent: string; keyword_properties: { intent?: string } }[] }[] }[] }>(
      `${DATAFORSEO_BASE}/v3/keywords_data/google_ads/search_volume/live`, tasks,
      { headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    const result = response.data.tasks?.[0]?.result?.[0];
    if (!result) throw new Error('DataForSEO keyword data returned no result');
    return result.items.map((item) => ({
      keyword: item.keyword,
      searchVolume: item.search_volume ?? 0,
      difficulty: Math.round((item.competition ?? 0) * 100),
      cpc: item.cpc ?? 0,
      intent: item.keyword_properties?.intent ?? item.keyword_intent ?? '',
      relatedKeywords: [],
    }));
  }

  async fetchKeywordIdeas(keyword: string, locationCode?: string): Promise<KeywordData[]> {
    const response = await axios.post<{ tasks: { result: { items: { keyword: string; search_volume: number; competition: number; cpc: number; keyword_intent: string; keyword_properties: { intent?: string } }[] }[] }[] }>(
      `${DATAFORSEO_BASE}/v3/dataforseo_labs/google/keyword_ideas/live`,
      [{ keyword, location_code: locationCode ? Number(locationCode) : 2840, language_code: 'en', include_serp_info: false, limit: 30 }],
      { headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    const items = response.data.tasks?.[0]?.result?.[0]?.items ?? [];
    return items.map((item) => ({
      keyword: item.keyword,
      searchVolume: item.search_volume ?? 0,
      difficulty: Math.round((item.competition ?? 0) * 100),
      cpc: item.cpc ?? 0,
      intent: item.keyword_properties?.intent ?? item.keyword_intent ?? '',
      relatedKeywords: [],
    }));
  }

  async fetchBacklinkOverview(domain: string): Promise<BacklinkOverview> {
    const result = await this.post<{ total_backlinks: number; referring_domains: number; domain_rating: number }>(
      '/v3/backlinks/summary/live', [{ target: domain, include_subdomains: false }]
    );
    return {
      totalBacklinks: result.total_backlinks ?? 0,
      referringDomains: result.referring_domains ?? 0,
      domainRating: result.domain_rating ?? 0,
    };
  }

  async fetchBacklinkList(domain: string, limit: number, offset: number = 0): Promise<BacklinkItem[]> {
    const response = await axios.post<{ tasks: { result: { items: { source_url: string; target_url: string; anchor_text: string; first_seen: string; spam_score: number }[] }[] }[] }>(
      `${DATAFORSEO_BASE}/v3/backlinks/backlinks/live`, [{ target: domain, limit, offset }],
      { headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' }, timeout: 30000 }
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
    const result = await this.post<{ organic_traffic_estimate: number; organic_keywords_count: number; top_keywords: { keyword: string; keyword_data?: { keyword_info?: { search_volume?: number }; avg_position?: number } }[] }>(
      '/v3/dataforseo_labs/google/domain_overview/live',
      [{ target: domain, location_code: 2840, language_code: 'en' }]
    );
    return {
      organicTrafficEstimate: result.organic_traffic_estimate ?? 0,
      organicKeywordCount: result.organic_keywords_count ?? 0,
      topKeywords: (result.top_keywords ?? []).map((k) => ({
        keyword: k.keyword,
        searchVolume: k.keyword_data?.keyword_info?.search_volume,
        position: k.keyword_data?.avg_position,
      })),
    };
  }

  async fetchReferringDomains(domain: string): Promise<string[]> {
    const response = await axios.post<{ tasks: { result: { items: { domain: string }[] }[] }[] }>(
      `${DATAFORSEO_BASE}/v3/backlinks/referring_domains/live`,
      [{ target: domain, limit: 1000 }],
      { headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' }, timeout: 30000 }
    );
    const items = response.data.tasks?.[0]?.result?.[0]?.items ?? [];
    return items.map((item) => item.domain).filter(Boolean);
  }
}

export const getDataProvider = (): IDataProvider => {
  if (!config.DATAFORSEO_LOGIN || !config.DATAFORSEO_PASSWORD || config.DATAFORSEO_LOGIN === '') {
    return new MockDataProvider();
  }
  return new DataForSEOProvider();
};

const getDateBucket = (date: Date = new Date()): string => date.toISOString().split('T')[0];

export const getKeywordData = async (
  keyword: string,
  locationCode?: string
): Promise<KeywordData> => {
  const now = new Date();
  const dateBucket = getDateBucket(now);
  const loc = locationCode ?? '';
  const cacheKey = `keyword:${keyword.toLowerCase().trim()}:${loc}`;

  const cached = await KeywordDataCache.findOne({ cacheKey, dateBucket });
  if (cached) {
    return {
      searchVolume: cached.searchVolume,
      difficulty: cached.difficulty,
      cpc: cached.cpc,
      intent: cached.intent,
      relatedKeywords: cached.relatedKeywords,
    };
  }

  const provider = getDataProvider();
  const results = await provider.fetchKeywordData([keyword], locationCode);
  const data = results[0];

  if (!data) throw new Error('No keyword data returned from provider');

  await KeywordDataCache.findOneAndUpdate(
    { cacheKey, dateBucket },
    {
      cacheKey, dateBucket, keyword: keyword.toLowerCase().trim(), locationCode: loc,
      searchVolume: data.searchVolume, difficulty: data.difficulty, cpc: data.cpc,
      intent: data.intent, relatedKeywords: data.relatedKeywords, cachedAt: now,
    },
    { upsert: true, new: true }
  );

  return data;
};

export const getKeywordIdeas = async (
  keyword: string,
  locationCode?: string
): Promise<KeywordData[]> => {
  const now = new Date();
  const dateBucket = getDateBucket(now);
  const loc = locationCode ?? '';
  const cacheKey = `ideas:${keyword.toLowerCase().trim()}:${loc}`;

  const cached = await KeywordDataCache.findOne({ cacheKey, dateBucket });
  if (cached && cached.relatedKeywords.length > 0) {
    return JSON.parse(cached.relatedKeywords[0]);
  }

  const provider = getDataProvider();
  const data = await provider.fetchKeywordIdeas(keyword, locationCode);

  await KeywordDataCache.findOneAndUpdate(
    { cacheKey, dateBucket },
    {
      cacheKey, dateBucket, keyword: keyword.toLowerCase().trim(), locationCode: loc,
      searchVolume: 0, difficulty: 0, cpc: 0, intent: '',
      relatedKeywords: [JSON.stringify(data)], cachedAt: now,
    },
    { upsert: true, new: true }
  );

  return data;
};

export const getBacklinkOverview = async (domain: string): Promise<BacklinkOverview> => {
  const now = new Date();
  const dateBucket = getDateBucket(now);
  const cacheKey = `bloverview:${domain.toLowerCase().trim()}`;

  const cached = await BacklinkDataCache.findOne({ cacheKey, dateBucket });
  if (cached) {
    return {
      totalBacklinks: cached.totalBacklinks,
      referringDomains: cached.referringDomains,
      domainRating: cached.domainRating,
    };
  }

  const provider = getDataProvider();
  const data = await provider.fetchBacklinkOverview(domain);

  await BacklinkDataCache.findOneAndUpdate(
    { cacheKey, dateBucket },
    {
      cacheKey, dateBucket, domain: domain.toLowerCase().trim(),
      totalBacklinks: data.totalBacklinks, referringDomains: data.referringDomains,
      domainRating: data.domainRating, cachedAt: now,
    },
    { upsert: true, new: true }
  );

  return data;
};

export const getBacklinkList = async (
  domain: string, limit: number = 100, offset: number = 0
): Promise<BacklinkItem[]> => {
  const provider = getDataProvider();
  return provider.fetchBacklinkList(domain, limit, offset);
};

export const getReferringDomains = async (domain: string): Promise<string[]> => {
  const provider = getDataProvider();
  return provider.fetchReferringDomains(domain);
};

export const getDomainOverview = async (domain: string): Promise<DomainOverview> => {
  const now = new Date();
  const dateBucket = getDateBucket(now);
  const cacheKey = `domainoverview:${domain.toLowerCase().trim()}`;

  const cached = await DomainOverviewCache.findOne({ cacheKey, dateBucket });
  if (cached) {
    return {
      organicTrafficEstimate: cached.organicTrafficEstimate,
      organicKeywordCount: cached.organicKeywordCount,
      topKeywords: cached.topKeywords,
    };
  }

  const provider = getDataProvider();
  const data = await provider.fetchDomainOverview(domain);

  await DomainOverviewCache.findOneAndUpdate(
    { cacheKey, dateBucket },
    {
      cacheKey, dateBucket, domain: domain.toLowerCase().trim(),
      organicTrafficEstimate: data.organicTrafficEstimate,
      organicKeywordCount: data.organicKeywordCount,
      topKeywords: data.topKeywords, cachedAt: now,
    },
    { upsert: true, new: true }
  );

  return data;
};
