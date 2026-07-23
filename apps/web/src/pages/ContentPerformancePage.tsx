import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  FileText,
  RefreshCw,
  Download,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import api, { API_BASE } from '../lib/api';
import { Card, Badge, Button, EmptyState } from '../components/ui';

// ── Types ─────────────────────────────────────────────────────────────

interface SeoIssue {
  severity: 'critical' | 'warning' | 'info';
  category: string;
  message: string;
}

interface PageMetrics {
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
  readabilityScore: number;
  imageCount: number;
  imagesWithAlt: number;
  imagesMissingAlt: number;
  internalLinkCount: number;
  externalLinkCount: number;
  hasStructuredData: boolean;
  structuredDataTypes: string[];
  canonicalUrl: string | null;
  isIndexable: boolean;
  seoScore: number;
  issues: SeoIssue[];
  analytics?: {
    sessions: number;
    engagementRate: number;
    avgEngagementTimeSec: number;
    conversions: number;
  } | null;
  searchConsole?: {
    clicks: number;
    impressions: number;
    ctr: number;
    avgPosition: number;
  } | null;
}

interface ContentPerformanceReport {
  reportId: string;
  projectId: string;
  crawlJobId: string;
  generatedAt: string;
  siteUrl: string;
  overallScore: number;
  pageCount: number;
  pages: PageMetrics[];
  summary: {
    avgScore: number;
    criticalIssueCount: number;
    warningIssueCount: number;
    topIssueCategories: { category: string; count: number }[];
  };
  gaConnected: boolean;
  gscConnected: boolean;
  _id?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-rose-400';
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-emerald-500/10 border-emerald-500/20';
  if (score >= 50) return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-rose-500/10 border-rose-500/20';
}

function issueBadgeVariant(sev: string): 'danger' | 'warning' | 'info' {
  if (sev === 'critical') return 'danger';
  if (sev === 'warning') return 'warning';
  return 'info';
}

// ── Page Row ──────────────────────────────────────────────────────────

function PageRow({ page }: { page: PageMetrics }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        onClick={() => setExpanded((o) => !o)}
        className="hover:bg-app-surface-raised transition-colors cursor-pointer group"
      >
        <td className="px-4 py-3 text-xs font-mono text-app-text-muted truncate max-w-[240px]" title={page.path}>
          {page.path}
        </td>
        <td className="px-4 py-3 text-center">
          <span className={`text-sm font-bold ${scoreColor(page.seoScore)}`}>{page.seoScore}</span>
        </td>
        <td className="px-4 py-3 text-center">
          <span className="text-xs font-semibold text-rose-400">
            {page.issues.filter((i) => i.severity === 'critical').length}
          </span>
        </td>
        <td className="px-4 py-3 text-center">
          <span className="text-xs font-semibold text-amber-400">
            {page.issues.filter((i) => i.severity === 'warning').length}
          </span>
        </td>
        <td className="px-4 py-3 text-center text-xs text-app-text-muted">{page.wordCount}</td>
        <td className="px-4 py-3 text-center">
          {page.isIndexable ? (
            <Badge variant="success">Yes</Badge>
          ) : (
            <Badge variant="danger">No</Badge>
          )}
        </td>
        <td className="px-4 py-3 text-center">
          <span className="text-app-text-muted group-hover:text-app-signal transition-colors">
            {expanded ? <ChevronUp className="h-3.5 w-3.5 inline" /> : <ChevronDown className="h-3.5 w-3.5 inline" />}
          </span>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={7} className="bg-app-surface-raised border-b border-app-border px-4 py-4">
            <div className="space-y-4">
              {/* Metrics grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Title', value: page.title ? `${page.titleLength} chars` : 'Missing' },
                  { label: 'Meta Desc', value: page.metaDescription ? `${page.metaDescriptionLength} chars` : 'Missing' },
                  { label: 'H1s', value: String(page.h1Count) },
                  { label: 'H2s', value: String(page.h2Count) },
                  { label: 'Readability', value: String(page.readabilityScore) },
                  { label: 'Images missing alt', value: String(page.imagesMissingAlt) },
                  { label: 'Internal links', value: String(page.internalLinkCount) },
                  { label: 'Schema', value: page.hasStructuredData ? page.structuredDataTypes.join(', ') || 'Yes' : 'None' },
                ].map((m) => (
                  <div key={m.label} className="bg-app-base rounded-lg p-2.5 border border-app-border">
                    <p className="text-[10px] text-app-text-muted mb-0.5">{m.label}</p>
                    <p className="text-xs font-semibold text-app-text truncate">{m.value}</p>
                  </div>
                ))}
              </div>

              {/* Analytics row */}
              {(page.analytics || page.searchConsole) && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  {page.analytics && (
                    <>
                      <div className="bg-app-signal/5 border border-app-signal/20 rounded-lg p-2.5">
                        <p className="text-[10px] text-app-text-muted mb-0.5">Sessions</p>
                        <p className="text-xs font-semibold text-app-text">{page.analytics.sessions}</p>
                      </div>
                      <div className="bg-app-signal/5 border border-app-signal/20 rounded-lg p-2.5">
                        <p className="text-[10px] text-app-text-muted mb-0.5">Engagement</p>
                        <p className="text-xs font-semibold text-app-text">{(page.analytics.engagementRate * 100).toFixed(1)}%</p>
                      </div>
                    </>
                  )}
                  {page.searchConsole && (
                    <>
                      <div className="bg-app-signal/5 border border-app-signal/20 rounded-lg p-2.5">
                        <p className="text-[10px] text-app-text-muted mb-0.5">Clicks</p>
                        <p className="text-xs font-semibold text-app-text">{page.searchConsole.clicks}</p>
                      </div>
                      <div className="bg-app-signal/5 border border-app-signal/20 rounded-lg p-2.5">
                        <p className="text-[10px] text-app-text-muted mb-0.5">Impressions</p>
                        <p className="text-xs font-semibold text-app-text">{page.searchConsole.impressions}</p>
                      </div>
                      <div className="bg-app-signal/5 border border-app-signal/20 rounded-lg p-2.5">
                        <p className="text-[10px] text-app-text-muted mb-0.5">CTR</p>
                        <p className="text-xs font-semibold text-app-text">{(page.searchConsole.ctr * 100).toFixed(1)}%</p>
                      </div>
                      <div className="bg-app-signal/5 border border-app-signal/20 rounded-lg p-2.5">
                        <p className="text-[10px] text-app-text-muted mb-0.5">Avg Position</p>
                        <p className="text-xs font-semibold text-app-text">{page.searchConsole.avgPosition.toFixed(1)}</p>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Issues list */}
              {page.issues.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-app-text mb-2">Issues</p>
                  {page.issues.map((issue, i) => (
                    <div key={i} className="flex items-start gap-2.5 text-xs">
                      <Badge variant={issueBadgeVariant(issue.severity)} className="flex-shrink-0 mt-0.5 capitalize">
                        {issue.severity}
                      </Badge>
                      <span className="text-app-text-muted">
                        <span className="text-app-text-muted/60 mr-1">[{issue.category}]</span>
                        {issue.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {page.issues.length === 0 && (
                <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
                  No issues detected
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────

type SortField = 'path' | 'seoScore' | 'critical' | 'warning';
type SortDir = 'asc' | 'desc';

export default function ContentPerformancePage() {
  const { id } = useParams<{ id: string }>();

  const [report, setReport] = useState<ContentPerformanceReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const [sortField, setSortField] = useState<SortField>('seoScore');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filterQuery, setFilterQuery] = useState('');

  // ── Generate report ────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!id) return;
    setGenerating(true);
    setError('');
    setReport(null);

    try {
      const { data } = await api.post<ContentPerformanceReport>(
        `/projects/${id}/reports/content-performance/generate`,
      );
      // The generate endpoint returns the full report directly
      setReport(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  // ── Download PDF ───────────────────────────────────────────────────
  const handleDownloadPdf = async () => {
    if (!id || !report) return;
    setError('');
    try {
      // Use the existing generate endpoint with type=content-performance to get a PDF token
      const { data } = await api.post<{ report: { downloadUrl: string } }>(
        `/projects/${id}/reports/generate`,
        { type: 'content-performance', crawlJobId: report.crawlJobId },
      );
      // Navigate to download URL (full page, triggers browser download)
      window.location.href = `${API_BASE.replace('/api', '')}${data.report.downloadUrl}`;
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to generate PDF download');
    }
  };

  // ── Sort + filter ──────────────────────────────────────────────────
  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'seoScore' ? 'asc' : 'asc');
    }
  };

  const sortedPages = report
    ? [...report.pages]
        .filter((p) =>
          filterQuery ? p.path.toLowerCase().includes(filterQuery.toLowerCase()) : true,
        )
        .sort((a, b) => {
          let va: number, vb: number;
          switch (sortField) {
            case 'path':
              return sortDir === 'asc'
                ? a.path.localeCompare(b.path)
                : b.path.localeCompare(a.path);
            case 'seoScore':
              va = a.seoScore; vb = b.seoScore; break;
            case 'critical':
              va = a.issues.filter((i) => i.severity === 'critical').length;
              vb = b.issues.filter((i) => i.severity === 'critical').length;
              break;
            case 'warning':
              va = a.issues.filter((i) => i.severity === 'warning').length;
              vb = b.issues.filter((i) => i.severity === 'warning').length;
              break;
            default:
              va = 0; vb = 0;
          }
          return sortDir === 'asc' ? va - vb : vb - va;
        })
    : [];

  const SortIcon = ({ field }: { field: SortField }) => (
    sortField === field ? (
      sortDir === 'asc' ? <ChevronUp className="h-3 w-3 inline ml-0.5" /> : <ChevronDown className="h-3 w-3 inline ml-0.5" />
    ) : null
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <Link
          to={`/projects/${id}`}
          className="text-xs text-app-signal hover:text-app-signal/80 font-semibold flex items-center space-x-1"
        >
          <span>← Back to Project</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-app-text-muted text-xs">Content Performance</span>
          {report && (
            <button
              onClick={handleDownloadPdf}
              className="text-xs text-app-signal hover:text-app-signal/80 font-semibold flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-app-signal/30 hover:bg-app-signal/10 transition-all"
            >
              <Download className="h-3 w-3" />
              Download PDF
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Generate button / empty state */}
      {!report && !generating && (
        <Card className="p-10 text-center">
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title="No Content Performance Report"
            description="Generate a report to see per-page SEO scores, issue breakdowns, and (if connected) GA4 and Search Console data."
          />
          <Button
            onClick={handleGenerate}
            className="mt-6 mx-auto"
          >
            Generate Report
          </Button>
        </Card>
      )}

      {/* Generating spinner */}
      {generating && (
        <Card className="p-10 text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-app-signal mx-auto mb-3" />
          <p className="text-sm text-app-text-muted">Scoring pages and computing report…</p>
        </Card>
      )}

      {/* Report loaded */}
      {report && (
        <div className="space-y-6">
          {/* Overall score + summary */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            {/* Big score */}
            <Card className={`p-5 flex flex-col items-center justify-center border ${scoreBg(report.overallScore)}`}>
              <p className={`text-5xl font-extrabold ${scoreColor(report.overallScore)}`}>{report.overallScore}</p>
              <p className="text-xs text-app-text-muted mt-1 uppercase tracking-wide font-semibold">Overall Score</p>
              <p className="text-[10px] text-app-text-muted mt-1">{report.pageCount} pages</p>
            </Card>

            {/* Summary pills */}
            {[
              { label: 'Avg Score', value: report.summary.avgScore, color: scoreColor(report.summary.avgScore) },
              { label: 'Critical Issues', value: report.summary.criticalIssueCount, color: 'text-rose-400' },
              { label: 'Warnings', value: report.summary.warningIssueCount, color: 'text-amber-400' },
            ].map((s) => (
              <Card key={s.label} className="p-5 flex flex-col items-center justify-center">
                <p className={`text-3xl font-extrabold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-app-text-muted mt-1">{s.label}</p>
              </Card>
            ))}
          </div>

          {/* Top categories */}
          {report.summary.topIssueCategories.length > 0 && (
            <Card className="p-4">
              <p className="text-xs font-bold text-white mb-3">Top Issue Categories</p>
              <div className="flex flex-wrap gap-2">
                {report.summary.topIssueCategories.map((c) => (
                  <div key={c.category} className="flex items-center gap-1.5 bg-app-surface-raised rounded-lg px-3 py-1.5 border border-app-border text-xs">
                    <span className="text-app-text capitalize">{c.category}</span>
                    <span className="font-bold text-rose-400">{c.count}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* GA/GSC connected note */}
          {!report.gaConnected && !report.gscConnected && (
            <div className="flex items-start gap-2.5 bg-app-signal/5 border border-app-signal/20 rounded-lg p-3 text-xs text-app-text-muted">
              <Info className="h-3.5 w-3.5 text-app-signal flex-shrink-0 mt-0.5" />
              <span>
                Connect Google Analytics and Search Console in{' '}
                <Link to={`/projects/${id}/settings`} className="text-app-signal hover:underline">
                  Project Settings
                </Link>{' '}
                to enrich this report with real traffic and search performance data.
              </span>
            </div>
          )}

          {/* Filter + Table */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
              <p className="text-xs font-bold text-white">Pages ({sortedPages.length})</p>
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter by path…"
                className="text-xs bg-app-base border border-app-border rounded-lg px-3 py-1.5 text-app-text outline-none focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 transition-colors w-48"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-app-border bg-app-surface-raised">
                    {[
                      { key: 'path' as SortField, label: 'Path' },
                      { key: 'seoScore' as SortField, label: 'Score' },
                      { key: 'critical' as SortField, label: 'Critical' },
                      { key: 'warning' as SortField, label: 'Warnings' },
                    ].map(({ key, label }) => (
                      <th
                        key={key}
                        onClick={() => toggleSort(key)}
                        className="px-4 py-2.5 text-left font-semibold text-app-text-muted cursor-pointer hover:text-app-text transition-colors select-none"
                      >
                        {label} <SortIcon field={key} />
                      </th>
                    ))}
                    <th className="px-4 py-2.5 text-center font-semibold text-app-text-muted">Words</th>
                    <th className="px-4 py-2.5 text-center font-semibold text-app-text-muted">Indexable</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-border">
                  {sortedPages.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-app-text-muted text-xs">
                        No pages match your filter.
                      </td>
                    </tr>
                  ) : (
                    sortedPages.map((page) => (
                      <PageRow key={page.url} page={page} />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Regenerate */}
          <div className="flex items-center justify-end">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="text-xs text-app-text-muted hover:text-app-text flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className={`h-3 w-3 ${generating ? 'animate-spin' : ''}`} />
              Regenerate Report
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
