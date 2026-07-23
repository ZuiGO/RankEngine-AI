export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface CrawlJob {
  id: string;
  url: string;
  status: JobStatus;
  userId: string;
  depth: number;
  resultCount: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

export interface CrawledPage {
  jobId: string;
  url: string;
  title: string;
  content: string;
  scrapedAt: string;
}

export interface HealthCheckResponse {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
  services: {
    database: 'connected' | 'disconnected';
    redis: 'connected' | 'disconnected';
  };
}

export * from './seoReports';
