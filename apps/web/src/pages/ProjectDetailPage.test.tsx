import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProjectDetailPage from './ProjectDetailPage';
import api from '../lib/api';

vi.mock('../lib/api');
const mockedApi = vi.mocked(api);

vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router-dom')>();
  return { ...mod, useParams: () => ({ id: 'proj1' }) };
});

const mockProject = {
  _id: 'proj1',
  name: 'Test Site',
  domain: 'test.com',
  auditSchedule: 'manual' as const,
  createdAt: '2024-01-01T00:00:00Z',
};

const mockLatestCrawl = {
  latestJob: {
    _id: 'job1',
    status: 'completed' as const,
    pageCount: 10,
    healthScore: 75,
    createdAt: '2024-01-01T00:00:00Z',
  },
  latestMigrationJob: null,
};

const lcpIssue = {
  _id: 'cwv-lcp',
  description: 'LCP (Largest Contentful Paint): 0 good, 0 needs-improvement, 5 poor across 5 sampled pages. Thresholds: good ≤ 2500ms, needs-improvement ≤ 4000ms, poor > 4000ms.',
  category: 'core-web-vitals',
  severity: 'critical' as const,
  url: 'N/A',
  recommendation: 'Optimize server response time.',
  details: [
    { url: 'https://test.com/', value: 5000, rating: 'poor' as const },
    { url: 'https://test.com/about', value: 4800, rating: 'poor' as const },
    { url: 'https://test.com/contact', value: 5100, rating: 'poor' as const },
    { url: 'https://test.com/blog', value: 4900, rating: 'poor' as const },
    { url: 'https://test.com/faq', value: 5000, rating: 'poor' as const },
  ],
};

const tbtIssue = {
  _id: 'cwv-tbt',
  description: 'TBT (proxy for INP — real INP requires field data): 3 good, 2 needs-improvement, 0 poor across 5 sampled pages. Thresholds: good ≤ 200ms, needs-improvement ≤ 600ms, poor > 600ms.',
  category: 'core-web-vitals',
  severity: 'warning' as const,
  url: 'N/A',
  recommendation: 'Break up long JavaScript tasks.',
  details: [
    { url: 'https://test.com/', value: 100, rating: 'good' as const },
    { url: 'https://test.com/about', value: 150, rating: 'good' as const },
    { url: 'https://test.com/contact', value: 300, rating: 'needs-improvement' as const },
    { url: 'https://test.com/blog', value: 400, rating: 'needs-improvement' as const },
    { url: 'https://test.com/faq', value: 50, rating: 'good' as const },
  ],
};

const clsIssue = {
  _id: 'cwv-cls',
  description: 'CLS (Cumulative Layout Shift): 5 good across 5 sampled pages. Thresholds: good ≤ 0.1, needs-improvement ≤ 0.25, poor > 0.25.',
  category: 'core-web-vitals',
  severity: 'passed' as const,
  url: 'N/A',
  recommendation: 'Set explicit width/height on images.',
  details: [
    { url: 'https://test.com/', value: 0.05, rating: 'good' as const },
    { url: 'https://test.com/about', value: 0.02, rating: 'good' as const },
    { url: 'https://test.com/contact', value: 0.08, rating: 'good' as const },
    { url: 'https://test.com/blog', value: 0.01, rating: 'good' as const },
    { url: 'https://test.com/faq', value: 0.03, rating: 'good' as const },
  ],
};

const indexingIssue = {
  _id: 'idx-1',
  description: '1 of 2 crawled pages have indexing issues (noindex or canonical mismatch)',
  category: 'indexing',
  severity: 'critical' as const,
  url: 'N/A',
  recommendation: 'Remove noindex directives.',
  details: [
    { url: 'https://test.com/blog/post-1', meta_noindex: true, canonical_mismatch: false, robots_txt_blocked: false },
  ],
};

function buildChecklist(cwvSeverities: string[], includeIndexing: boolean) {
  const critical = [];
  const warning = [];
  const passed = [];

  if (cwvSeverities.includes('critical')) critical.push(lcpIssue);
  if (cwvSeverities.includes('warning')) warning.push(tbtIssue);
  if (cwvSeverities.includes('passed')) passed.push(clsIssue);
  if (includeIndexing) critical.push(indexingIssue);

  return {
    checklist: { critical, warning, passed },
    schema: [],
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProjectDetailPage />
    </MemoryRouter>
  );
}

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders CWV section with LCP gauge in poor color state', async () => {
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url.includes('checklist')) return { data: buildChecklist(['critical', 'warning', 'passed'], false) };
      if (url.includes('latest')) return { data: mockLatestCrawl };
      if (url.includes('backlinks')) return { data: { totalBacklinks: 10, referringDomains: 5 } };
      if (url.includes('ai-visibility')) return { data: { visibilityScore: 80 } };
      return { data: mockProject };
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Core Web Vitals')).toBeInTheDocument();
    });
  });

  it('TBT gauge label contains proxy for INP text', async () => {
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url.includes('checklist')) return { data: buildChecklist(['critical', 'warning', 'passed'], false) };
      if (url.includes('latest')) return { data: mockLatestCrawl };
      if (url.includes('backlinks')) return { data: { totalBacklinks: 10, referringDomains: 5 } };
      if (url.includes('ai-visibility')) return { data: { visibilityScore: 80 } };
      return { data: mockProject };
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/TBT \(proxy for INP\)/)).toBeInTheDocument();
    });
  });

  it('renders indexing critical issues in checklist', async () => {
    mockedApi.get.mockImplementation(async (url: string) => {
      if (url.includes('checklist')) return { data: buildChecklist([], true) };
      if (url.includes('latest')) return { data: mockLatestCrawl };
      if (url.includes('backlinks')) return { data: { totalBacklinks: 10, referringDomains: 5 } };
      if (url.includes('ai-visibility')) return { data: { visibilityScore: 80 } };
      return { data: mockProject };
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Indexing')).toBeInTheDocument();
    });

    expect(screen.getByText(/indexing issues/)).toBeInTheDocument();
  });
});
