export interface SeoIssue {
  severity: 'critical' | 'warning' | 'info';
  category:
    | 'title'
    | 'meta'
    | 'headings'
    | 'content'
    | 'images'
    | 'links'
    | 'structured-data'
    | 'indexability'
    | 'performance';
  message: string;
}

export interface PageAnalyticsSnapshot {
  sessions: number;
  engagementRate: number;
  avgEngagementTimeSec: number;
  conversions: number;
}

export interface PageSearchConsoleSnapshot {
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
}

export interface PageSeoMetrics {
  url: string;
  path: string;
  title: string | null;
  titleLength: number;
  metaDescription: string | null;
  metaDescriptionLength: number;
  h1Count: number;
  h1Text: string[];
  h2Count: number;
  wordCount: number;
  readabilityScore: number; // Flesch Reading Ease, 0-100
  imageCount: number;
  imagesWithAlt: number;
  imagesMissingAlt: number;
  internalLinkCount: number;
  externalLinkCount: number;
  hasStructuredData: boolean;
  structuredDataTypes: string[];
  canonicalUrl: string | null;
  isIndexable: boolean;
  cwv: {
    lcp: number | null;
    inp: number | null;
    cls: number | null;
    fcp: number | null;
    ttfb: number | null;
  } | null;
  analytics: PageAnalyticsSnapshot | null;
  searchConsole: PageSearchConsoleSnapshot | null;
  seoScore: number; // 0-100 composite, see scoring rules
  issues: SeoIssue[];
}

export interface ContentPerformanceReport {
  reportId: string;
  projectId: string;
  crawlJobId: string;
  generatedAt: string;
  siteUrl: string;
  overallScore: number;
  pageCount: number;
  pages: PageSeoMetrics[];
  summary: {
    avgScore: number;
    criticalIssueCount: number;
    warningIssueCount: number;
    topIssueCategories: { category: string; count: number }[];
  };
  gaConnected: boolean;
  gscConnected: boolean;
}

export interface PageComparisonChange {
  field: string;
  before: unknown;
  after: unknown;
  impact: 'improvement' | 'regression' | 'neutral';
}

export interface PageComparisonMetrics {
  path: string;
  oldUrl: string | null;
  newUrl: string | null;
  matched: boolean; // false = page added or removed between versions
  status: 'matched' | 'added' | 'removed';
  before: PageSeoMetrics | null;
  after: PageSeoMetrics | null;
  scoreDelta: number | null;
  changes: PageComparisonChange[];
}

export interface BeforeAfterComparisonReport {
  reportId: string;
  projectId: string;
  generatedAt: string;
  oldSiteUrl: string;
  newSiteUrl: string;
  oldCrawlJobId: string;
  newCrawlJobId: string;
  overallScoreBefore: number;
  overallScoreAfter: number;
  pagesImproved: number;
  pagesRegressed: number;
  pagesUnchanged: number;
  pagesAdded: number;
  pagesRemoved: number;
  pages: PageComparisonMetrics[];
  note: string; // fixed disclaimer about "after" having no real traffic data yet
}

export interface GoogleIntegrationStatus {
  connected: boolean;
  gaPropertyId?: string;
  gscSiteUrl?: string;
  connectedAt?: string;
  lastSyncedAt?: string;
  scopes?: string[];
}
