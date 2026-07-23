import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  GitCompare,
  RefreshCw,
  Download,
  ChevronDown,
  ChevronUp,
  Info,
  Plus,
  Trash2,
} from 'lucide-react';
import api, { API_BASE } from '../lib/api';
import { Card, Badge, Button, EmptyState } from '../components/ui';

// ── Types ─────────────────────────────────────────────────────────────

interface PageChange {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
  impact: 'improvement' | 'regression' | 'neutral';
}

interface PageComparison {
  path: string;
  oldUrl: string | null;
  newUrl: string | null;
  status: 'matched' | 'added' | 'removed';
  scoreDelta: number | null;
  before: { seoScore: number } | null;
  after: { seoScore: number } | null;
  changes: PageChange[];
}

interface ComparisonReport {
  reportId: string;
  projectId: string;
  generatedAt: string;
  oldSiteUrl: string;
  newSiteUrl: string;
  overallScoreBefore: number;
  overallScoreAfter: number;
  pagesImproved: number;
  pagesRegressed: number;
  pagesUnchanged: number;
  pagesAdded: number;
  pagesRemoved: number;
  pages: PageComparison[];
  note: string;
}

interface PathOverride {
  oldPath: string;
  newPath: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-rose-400';
}

function impactStyle(impact: string): string {
  if (impact === 'improvement') return 'text-emerald-400';
  if (impact === 'regression') return 'text-rose-400';
  return 'text-app-text-muted';
}

function impactBg(impact: string): string {
  if (impact === 'improvement') return 'bg-emerald-500/5';
  if (impact === 'regression') return 'bg-rose-500/5';
  return '';
}

// ── Page Row ──────────────────────────────────────────────────────────

function PageComparisonRow({ page }: { page: PageComparison }) {
  const [expanded, setExpanded] = useState(false);
  const delta = page.scoreDelta ?? 0;

  return (
    <>
      <tr
        onClick={() => setExpanded((o) => !o)}
        className="hover:bg-app-surface-raised transition-colors cursor-pointer group"
      >
        <td className="px-4 py-3 text-xs font-mono text-app-text-muted truncate max-w-[200px]" title={page.path}>
          {page.path}
        </td>
        <td className="px-4 py-3 text-center text-xs font-semibold">
          <span className={page.before ? scoreColor(page.before.seoScore) : 'text-app-text-muted'}>
            {page.before?.seoScore ?? '–'}
          </span>
        </td>
        <td className="px-4 py-3 text-center text-xs font-semibold">
          <span className={page.after ? scoreColor(page.after.seoScore) : 'text-app-text-muted'}>
            {page.after?.seoScore ?? '–'}
          </span>
        </td>
        <td className="px-4 py-3 text-center">
          {page.status === 'matched' ? (
            <span className={`text-xs font-bold ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-app-text-muted'}`}>
              {delta > 0 ? `+${delta}` : delta}
            </span>
          ) : page.status === 'added' ? (
            <Badge variant="success">Added</Badge>
          ) : (
            <Badge variant="danger">Removed</Badge>
          )}
        </td>
        <td className="px-4 py-3 text-center text-xs text-app-text-muted">
          {page.status === 'matched' ? page.changes.length : '—'}
        </td>
        <td className="px-4 py-3 text-center">
          <span className="text-app-text-muted group-hover:text-app-signal transition-colors">
            {expanded ? <ChevronUp className="h-3.5 w-3.5 inline" /> : <ChevronDown className="h-3.5 w-3.5 inline" />}
          </span>
        </td>
      </tr>

      {expanded && page.status === 'matched' && (
        <tr>
          <td colSpan={6} className="bg-app-surface-raised border-b border-app-border px-4 py-4">
            {page.changes.length === 0 ? (
              <p className="text-xs text-app-text-muted">No field changes detected between the two versions.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-app-text-muted border-b border-app-border">
                      <th className="pb-2 pr-4 font-semibold">Field</th>
                      <th className="pb-2 pr-4 font-semibold">Before</th>
                      <th className="pb-2 pr-4 font-semibold">After</th>
                      <th className="pb-2 font-semibold">Impact</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-app-border">
                    {page.changes.map((c, i) => (
                      <tr key={i} className={impactBg(c.impact)}>
                        <td className="py-2 pr-4 font-medium text-app-text">{c.field}</td>
                        <td className="py-2 pr-4 text-app-text-muted font-mono">{String(c.before ?? '–')}</td>
                        <td className={`py-2 pr-4 font-mono font-semibold ${impactStyle(c.impact)}`}>{String(c.after ?? '–')}</td>
                        <td className={`py-2 capitalize font-semibold ${impactStyle(c.impact)}`}>{c.impact}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';

export default function ComparisonReportPage() {
  const { id } = useParams<{ id: string }>();

  // Form state
  const [oldUrl, setOldUrl] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [pathOverrides, setPathOverrides] = useState<PathOverride[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Report state
  const [report, setReport] = useState<ComparisonReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  // Sort state
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [addedOpen, setAddedOpen] = useState(false);
  const [removedOpen, setRemovedOpen] = useState(false);

  // ── Path override helpers ──────────────────────────────────────────

  const addOverride = () =>
    setPathOverrides((prev) => [...prev, { oldPath: '', newPath: '' }]);

  const removeOverride = (idx: number) =>
    setPathOverrides((prev) => prev.filter((_, i) => i !== idx));

  const updateOverride = (idx: number, key: keyof PathOverride, value: string) =>
    setPathOverrides((prev) =>
      prev.map((o, i) => (i === idx ? { ...o, [key]: value } : o)),
    );

  // ── Generate ───────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!id) return;
    if (!oldUrl.trim() || !newUrl.trim()) {
      setError('Both Old URL and New URL are required.');
      return;
    }
    setGenerating(true);
    setError('');
    setReport(null);

    try {
      const body: Record<string, unknown> = {
        oldUrl: oldUrl.trim(),
        newUrl: newUrl.trim(),
      };
      if (pathOverrides.filter((o) => o.oldPath && o.newPath).length > 0) {
        body.pathOverrides = pathOverrides
          .filter((o) => o.oldPath && o.newPath)
          .reduce((acc, o) => ({ ...acc, [o.oldPath]: o.newPath }), {} as Record<string, string>);
      }
      const { data } = await api.post<ComparisonReport>(
        `/projects/${id}/reports/comparison/generate`,
        body,
      );
      setReport(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to generate comparison report');
    } finally {
      setGenerating(false);
    }
  };

  // ── Download PDF ───────────────────────────────────────────────────

  const handleDownloadPdf = async () => {
    if (!id || !report) return;
    setError('');
    try {
      const { data } = await api.post<{ report: { downloadUrl: string } }>(
        `/projects/${id}/reports/generate`,
        {
          type: 'before-after-comparison',
          oldUrl: report.oldSiteUrl,
          newUrl: report.newSiteUrl,
        },
      );
      window.location.href = `${API_BASE.replace('/api', '')}${data.report.downloadUrl}`;
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to generate PDF download');
    }
  };

  // ── Sort matched pages ─────────────────────────────────────────────

  const matchedPages = report
    ? [...report.pages]
        .filter((p) => p.status === 'matched')
        .sort((a, b) => {
          const da = a.scoreDelta ?? 0;
          const db = b.scoreDelta ?? 0;
          return sortDir === 'asc' ? da - db : db - da;
        })
    : [];

  const addedPages = report?.pages.filter((p) => p.status === 'added') ?? [];
  const removedPages = report?.pages.filter((p) => p.status === 'removed') ?? [];

  const toggleSortDir = () => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));

  const delta = report ? report.overallScoreAfter - report.overallScoreBefore : 0;

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
          <span className="text-app-text-muted text-xs">Before / After Comparison</span>
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

      {/* Generation form */}
      <Card className="p-5 mb-6">
        <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <GitCompare className="h-4 w-4 text-app-signal" />
          Compare Two Sites
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-app-text mb-1.5">Old (Live) Site URL</label>
            <input
              type="url"
              value={oldUrl}
              onChange={(e) => setOldUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full text-sm bg-app-base border border-app-border rounded-lg px-3 py-2 text-app-text outline-none focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 transition-colors font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-app-text mb-1.5">New (Staging) Site URL</label>
            <input
              type="url"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://staging.example.com"
              className="w-full text-sm bg-app-base border border-app-border rounded-lg px-3 py-2 text-app-text outline-none focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 transition-colors font-mono"
            />
          </div>
        </div>

        {/* Advanced: path overrides */}
        <div className="mb-4">
          <button
            onClick={() => setShowAdvanced((o) => !o)}
            className="text-xs text-app-text-muted hover:text-app-text flex items-center gap-1.5 transition-colors"
          >
            {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Advanced: manual path overrides
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-2">
              {pathOverrides.map((o, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={o.oldPath}
                    onChange={(e) => updateOverride(idx, 'oldPath', e.target.value)}
                    placeholder="/old-path"
                    className="flex-1 text-xs bg-app-base border border-app-border rounded-lg px-3 py-1.5 text-app-text outline-none focus:border-app-signal font-mono transition-colors"
                  />
                  <span className="text-app-text-muted text-xs">→</span>
                  <input
                    type="text"
                    value={o.newPath}
                    onChange={(e) => updateOverride(idx, 'newPath', e.target.value)}
                    placeholder="/new-path"
                    className="flex-1 text-xs bg-app-base border border-app-border rounded-lg px-3 py-1.5 text-app-text outline-none focus:border-app-signal font-mono transition-colors"
                  />
                  <button
                    onClick={() => removeOverride(idx)}
                    className="text-app-text-muted hover:text-rose-400 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                onClick={addOverride}
                className="text-xs text-app-signal hover:text-app-signal/80 flex items-center gap-1 transition-colors mt-1"
              >
                <Plus className="h-3 w-3" />
                Add path override
              </button>
            </div>
          )}
        </div>

        <Button
          onClick={handleGenerate}
          loading={generating}
          disabled={generating}
          className="w-full sm:w-auto"
        >
          {generating ? 'Generating…' : 'Generate Comparison'}
        </Button>
      </Card>

      {/* Generating spinner */}
      {generating && (
        <Card className="p-10 text-center mb-6">
          <RefreshCw className="h-8 w-8 animate-spin text-app-signal mx-auto mb-3" />
          <p className="text-sm text-app-text-muted">Crawling and comparing sites…</p>
          <p className="text-xs text-app-text-muted mt-1">This may take a few minutes</p>
        </Card>
      )}

      {/* No report yet */}
      {!report && !generating && (
        <Card className="p-10 text-center">
          <EmptyState
            icon={<GitCompare className="h-7 w-7" />}
            title="No Comparison Generated"
            description="Fill in the old and new site URLs above and click Generate Comparison to compare SEO scores between two versions of a site."
          />
        </Card>
      )}

      {/* Report loaded */}
      {report && (
        <div className="space-y-6">
          {/* Score delta badge */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="bg-app-surface border border-app-border rounded-2xl px-6 py-4 flex items-center gap-4">
              <div className="text-center">
                <p className="text-3xl font-extrabold text-white">{report.overallScoreBefore}</p>
                <p className="text-xs text-app-text-muted mt-0.5">Before</p>
              </div>
              <div className="text-app-text-muted text-xl font-bold">→</div>
              <div className="text-center">
                <p className={`text-3xl font-extrabold ${scoreColor(report.overallScoreAfter)}`}>{report.overallScoreAfter}</p>
                <p className="text-xs text-app-text-muted mt-0.5">After</p>
              </div>
              <span className={`text-xl font-bold px-3 py-1 rounded-xl ${delta >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                {delta >= 0 ? `+${delta}` : delta}
              </span>
            </div>
          </div>

          {/* Summary stats */}
          <div className="flex flex-wrap gap-3">
            {[
              { label: 'Improved', value: report.pagesImproved, color: 'text-emerald-400' },
              { label: 'Regressed', value: report.pagesRegressed, color: 'text-rose-400' },
              { label: 'Unchanged', value: report.pagesUnchanged, color: 'text-app-text-muted' },
              { label: 'Added', value: report.pagesAdded, color: 'text-app-signal' },
              { label: 'Removed', value: report.pagesRemoved, color: 'text-amber-400' },
            ].map((s) => (
              <div key={s.label} className="bg-app-surface border border-app-border rounded-xl px-4 py-3 text-center min-w-[80px]">
                <p className={`text-xl font-extrabold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] text-app-text-muted mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Disclaimer note */}
          <div className="flex items-start gap-2.5 bg-app-signal/5 border border-app-signal/20 rounded-lg p-3 text-xs text-app-text-muted">
            <Info className="h-3.5 w-3.5 text-app-signal flex-shrink-0 mt-0.5" />
            <span>{report.note}</span>
          </div>

          {/* Matched pages table */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
              <p className="text-xs font-bold text-white">Matched Pages ({matchedPages.length})</p>
              <button
                onClick={toggleSortDir}
                className="text-xs text-app-text-muted hover:text-app-text flex items-center gap-1 transition-colors"
              >
                Sort by Δ score {sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-app-border bg-app-surface-raised text-left text-app-text-muted">
                    <th className="px-4 py-2.5 font-semibold">Path</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Score Before</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Score After</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Δ</th>
                    <th className="px-4 py-2.5 text-center font-semibold">Changes</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-border">
                  {matchedPages.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-app-text-muted text-xs">
                        No matched pages found.
                      </td>
                    </tr>
                  ) : (
                    matchedPages.map((page) => (
                      <PageComparisonRow key={page.path} page={page} />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Added pages */}
          {addedPages.length > 0 && (
            <Card className="overflow-hidden">
              <button
                onClick={() => setAddedOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-3 border-b border-app-border hover:bg-app-surface-raised transition-colors"
              >
                <p className="text-xs font-bold text-emerald-400">Added Pages ({addedPages.length})</p>
                {addedOpen ? <ChevronUp className="h-3.5 w-3.5 text-app-text-muted" /> : <ChevronDown className="h-3.5 w-3.5 text-app-text-muted" />}
              </button>
              {addedOpen && (
                <ul className="divide-y divide-app-border">
                  {addedPages.map((p) => (
                    <li key={p.path} className="px-4 py-2.5 flex items-center justify-between text-xs">
                      <span className="font-mono text-app-text-muted">{p.path}</span>
                      <span className={`font-semibold ${p.after ? scoreColor(p.after.seoScore) : 'text-app-text-muted'}`}>
                        Score: {p.after?.seoScore ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {/* Removed pages */}
          {removedPages.length > 0 && (
            <Card className="overflow-hidden">
              <button
                onClick={() => setRemovedOpen((o) => !o)}
                className="w-full flex items-center justify-between px-4 py-3 border-b border-app-border hover:bg-app-surface-raised transition-colors"
              >
                <p className="text-xs font-bold text-rose-400">Removed Pages ({removedPages.length})</p>
                {removedOpen ? <ChevronUp className="h-3.5 w-3.5 text-app-text-muted" /> : <ChevronDown className="h-3.5 w-3.5 text-app-text-muted" />}
              </button>
              {removedOpen && (
                <ul className="divide-y divide-app-border">
                  {removedPages.map((p) => (
                    <li key={p.path} className="px-4 py-2.5 flex items-center justify-between text-xs">
                      <span className="font-mono text-app-text-muted">{p.path}</span>
                      <span className={`font-semibold ${p.before ? scoreColor(p.before.seoScore) : 'text-app-text-muted'}`}>
                        Was: {p.before?.seoScore ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
