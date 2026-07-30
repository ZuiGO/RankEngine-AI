import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import api from '../lib/api';
import { Card, CardBody, Badge, Button, EmptyState } from '../components/ui';

interface TopKeyword {
  keyword: string;
  searchVolume?: number;
  position?: number;
}

interface DomainOverviewData {
  organicTrafficEstimate: number;
  organicKeywordCount: number;
  topKeywords: TopKeyword[];
}

interface CompareEntry {
  domain: string;
  organicTrafficEstimate: number;
  organicKeywordCount: number;
  topKeywords: TopKeyword[];
  error?: string | null;
}

interface CompareResponse {
  comparison: CompareEntry[];
}

interface GapKeywordEntry {
  keyword: string;
  rankCount: number;
  domains: string[];
}

interface KeywordGapResponse {
  projectDomain: string;
  competitors: string[];
  yourAdvantage: string[];
  gapOpportunities: GapKeywordEntry[];
  partialOverlap: GapKeywordEntry[];
  gapOpportunityCount: number;
}

interface LinkOpportunity {
  domain: string;
  linkedBy: string[];
}

interface BacklinkGapResponse {
  projectDomain: string;
  competitors: string[];
  linkOpportunities: LinkOpportunity[];
  linkOpportunityCount: number;
}

interface ProjectInfo {
  domain: string;
  name: string;
}

type Tab = 'overview' | 'keyword-gap' | 'backlink-gap';

const BAR_COLORS = ['#6366f1', '#34d399', '#fbbf24', '#f97316', '#ec4899', '#8b5cf6'];

export default function CompetitorsPage() {
  const { id } = useParams<{ id: string }>();

  const [tab, setTab] = useState<Tab>('overview');
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [overview, setOverview] = useState<DomainOverviewData | null>(null);
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [competitorInput, setCompetitorInput] = useState('');
  const [compareData, setCompareData] = useState<CompareEntry[]>([]);
  const [keywordGap, setKeywordGap] = useState<KeywordGapResponse | null>(null);
  const [backlinkGap, setBacklinkGap] = useState<BacklinkGapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState('');
  const [trackingKeyword, setTrackingKeyword] = useState<string | null>(null);

  const quotaUsed = 0;
  const quotaLimit = 0;
  const quotaPct = 0;

  const fetchOverview = useCallback(async () => {
    if (!id) return;
    try {
      const [projRes, ovRes] = await Promise.all([
        api.get<ProjectInfo>(`/projects/${id}`),
        api.get<DomainOverviewData>(`/projects/${id}/domain-overview`).catch(() => null),
      ]);
      setProjectInfo(projRes.data);
      if (ovRes) setOverview(ovRes.data);
    } catch {
      setError('Failed to load project data.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const runGapAnalysis = useCallback(async (comps: string[]) => {
    if (!id || comps.length === 0) return;
    setComparing(true);
    setError('');
    try {
      const [compRes, kwRes, blRes] = await Promise.all([
        api.post<CompareResponse>(`/projects/${id}/domain-overview/compare`, { competitors: comps }),
        api.post<KeywordGapResponse>(`/projects/${id}/keyword-gap`, { competitors: comps }),
        api.post<BacklinkGapResponse>(`/projects/${id}/backlink-gap`, { competitors: comps }),
      ]);
      setCompareData(compRes.data.comparison);
      setKeywordGap(kwRes.data);
      setBacklinkGap(blRes.data);
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Gap analysis failed';
      setError(msg);
    } finally {
      setComparing(false);
    }
  }, [id]);

  const handleAddCompetitor = () => {
    const domain = competitorInput.trim().toLowerCase();
    if (!domain) return;
    if (competitors.length >= 5) {
      setError('Maximum 5 competitors allowed.');
      return;
    }
    if (competitors.includes(domain)) {
      setError('Competitor already added.');
      return;
    }
    const updated = [...competitors, domain];
    setCompetitors(updated);
    setCompetitorInput('');
    setError('');
    runGapAnalysis(updated);
  };

  const handleRemoveCompetitor = (domain: string) => {
    const updated = competitors.filter((c) => c !== domain);
    setCompetitors(updated);
    if (updated.length === 0) {
      setCompareData([]);
      setKeywordGap(null);
      setBacklinkGap(null);
    } else {
      runGapAnalysis(updated);
    }
  };

  const handleTrackKeyword = async (kw: string) => {
    if (!id) return;
    setTrackingKeyword(kw);
    try {
      const targetUrl = projectInfo?.domain ? `https://${projectInfo.domain}` : '';
      await api.post(`/projects/${id}/keywords`, {
        keyword: kw,
        targetUrl,
      });
    } catch {
      // silently ignore
    } finally {
      setTrackingKeyword(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAddCompetitor();
  };

  const formatNumber = (n: number) => n.toLocaleString();

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Domain Overview' },
    { key: 'keyword-gap', label: 'Keyword Gap' },
    { key: 'backlink-gap', label: 'Backlink Gap' },
  ];

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-3 py-8">
          <div className="h-4 w-48 bg-app-surface-raised rounded animate-pulse mx-auto" />
          <div className="h-4 w-64 bg-app-surface-raised rounded animate-pulse mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between mb-6">
        <Link
          to={`/projects/${id}`}
          className="text-xs text-app-signal hover:text-app-signal/80 font-semibold flex items-center gap-1 transition-all duration-150"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Project
        </Link>

        {/* Quota */}
        <div className="flex items-center gap-2 text-xs text-app-text-muted">
          <span className="font-medium text-app-text">Quota</span>
          <div className="h-1.5 w-24 bg-app-border rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-150 ${
                quotaPct >= 90 ? 'bg-rose-500' : quotaPct >= 70 ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
              style={{ width: `${Math.min(quotaPct, 100)}%` }}
            />
          </div>
          <span className="font-mono tabular-nums">
            <span className="text-app-text">{quotaUsed}</span>
            {' / '}
            <span className="text-app-text-muted">{quotaLimit}</span>
          </span>
        </div>
      </div>

      {/* Explainer */}
      <div className="bg-app-signal/5 border border-app-signal/10 rounded-2xl p-4 mb-8">
        <p className="text-xs text-app-text leading-relaxed">
          <span className="text-app-signal font-semibold">Competitor Analysis</span> compares
          your domain against up to five competitors side by side — uncovering keyword gaps,
          link opportunities, and how your organic presence stacks up.
        </p>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Domain Overview Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Project stats */}
        <Card>
          <CardBody>
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <span className="text-app-signal font-mono text-xs">{projectInfo?.domain ?? id}</span>
            </h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-2xs text-app-text-muted uppercase font-semibold tracking-wider mb-1">
                  Traffic Estimate
                </p>
                <p className="text-2xl font-bold text-white tabular-nums">
                  {overview ? formatNumber(overview.organicTrafficEstimate) : '…'}
                </p>
              </div>
              <div>
                <p className="text-2xs text-app-text-muted uppercase font-semibold tracking-wider mb-1">
                  Keyword Count
                </p>
                <p className="text-2xl font-bold text-white tabular-nums">
                  {overview ? formatNumber(overview.organicKeywordCount) : '…'}
                </p>
              </div>
            </div>
            {overview && overview.topKeywords.length > 0 && (
              <div>
                <p className="text-2xs text-app-text-muted uppercase font-semibold tracking-wider mb-1.5">
                  Top Keywords
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {overview.topKeywords.slice(0, 8).map((kw, i) => (
                    <Badge key={i} variant="default" className="bg-app-base rounded-md font-mono px-2">
                      {kw.keyword}
                      {kw.position != null && (
                        <span className="text-app-text-muted ml-1">#{kw.position}</span>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Add competitor */}
        <Card>
          <CardBody>
            <h3 className="text-sm font-bold text-white mb-3">Add Competitors</h3>
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={competitorInput}
                onChange={(e) => setCompetitorInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. competitor.com"
                className="flex-1 bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg text-xs px-3 py-2 text-white placeholder-app-text-muted outline-none transition-all duration-150"
              />
              <Button
                onClick={handleAddCompetitor}
                disabled={comparing || !competitorInput.trim() || competitors.length >= 5}
                className="text-xs flex-shrink-0 shadow-none"
              >
                {comparing ? '…' : 'Add'}
              </Button>
            </div>
            {competitors.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {competitors.map((c) => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1.5 bg-app-signal/10 border border-app-signal/20 text-app-signal text-2xs font-semibold px-2.5 py-1 rounded-full"
                  >
                    <a
                      href={c.startsWith('http') ? c : `https://${c}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline flex items-center gap-1"
                    >
                      {c}
                    </a>
                    <button onClick={() => handleRemoveCompetitor(c)} className="hover:text-white transition-colors ml-1">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
                {competitors.length < 5 && (
                  <span className="text-2xs text-app-text-muted self-center">
                    {5 - competitors.length} slot{5 - competitors.length !== 1 ? 's' : ''} remaining
                  </span>
                )}
              </div>
            )}
            {competitors.length === 0 && (
              <p className="text-2xs text-app-text-muted mt-1">
                Add up to 5 competitor domains to start a gap analysis.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Tabs */}
      {compareData.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-1 border-b border-app-border mb-6">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`text-xs font-semibold px-4 py-2.5 transition-all duration-150 border-b-2 -mb-[1px] ${
                  tab === t.key
                    ? 'text-app-signal border-app-signal'
                    : 'text-app-text-muted border-transparent hover:text-app-text'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab: Domain Overview (comparison chart) */}
          {tab === 'overview' && (
            <div className="space-y-6">
              {comparing && (
                <Card>
                  <CardBody className="p-6 text-center">
                    <div className="space-y-2">
                    <div className="h-3 w-36 bg-app-surface-raised rounded animate-pulse mx-auto" />
                    <div className="h-3 w-24 bg-app-surface-raised rounded animate-pulse mx-auto" />
                  </div>
                  </CardBody>
                </Card>
              )}
              {!comparing && (
                <>
                  {/* Traffic comparison */}
                  <Card>
                    <CardBody>
                      <h3 className="text-sm font-bold text-white mb-4">Organic Traffic Comparison</h3>
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={compareData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-app-border)" />
                            <XAxis
                              dataKey="domain"
                              stroke="var(--color-app-text-muted)"
                              tick={{ fontSize: 10 }}
                              tickFormatter={(v: string) => {
                                const p = projectInfo?.domain ?? '';
                                return v === p ? 'You' : v.replace(/\.[^.]+$/, '');
                              }}
                            />
                            <YAxis stroke="var(--color-app-text-muted)" tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumber(Number(v))} />
                            <Tooltip
                              contentStyle={{ backgroundColor: 'var(--color-app-surface)', border: '1px solid var(--color-app-border)', borderRadius: '8px', fontSize: '12px' }}
                              labelStyle={{ color: 'var(--color-app-text-muted)' }}
                              formatter={(value: any) => [formatNumber(Number(value)), 'Traffic']}
                            />
                            <Bar dataKey="organicTrafficEstimate" radius={[4, 4, 0, 0]} maxBarSize={60}>
                              {compareData.map((_, i) => (
                                <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardBody>
                  </Card>

                  {/* Keyword count comparison */}
                  <Card>
                    <CardBody>
                      <h3 className="text-sm font-bold text-white mb-4">Keyword Count Comparison</h3>
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={compareData} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-app-border)" />
                            <XAxis
                              dataKey="domain"
                              stroke="var(--color-app-text-muted)"
                              tick={{ fontSize: 10 }}
                              tickFormatter={(v: string) => {
                                const p = projectInfo?.domain ?? '';
                                return v === p ? 'You' : v.replace(/\.[^.]+$/, '');
                              }}
                            />
                            <YAxis stroke="var(--color-app-text-muted)" tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumber(Number(v))} />
                            <Tooltip
                              contentStyle={{ backgroundColor: 'var(--color-app-surface)', border: '1px solid var(--color-app-border)', borderRadius: '8px', fontSize: '12px' }}
                              labelStyle={{ color: 'var(--color-app-text-muted)' }}
                              formatter={(value: any) => [formatNumber(Number(value)), 'Keywords']}
                            />
                            <Bar dataKey="organicKeywordCount" radius={[4, 4, 0, 0]} maxBarSize={60}>
                              {compareData.map((_, i) => (
                                <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardBody>
                  </Card>

                  {/* Full comparison table */}
                  <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm text-app-text">
                        <thead className="bg-app-base/80 text-app-text-muted uppercase font-semibold text-2xs border-b border-app-border">
                          <tr>
                            <th className="p-4">Domain</th>
                            <th className="p-4 text-right">Traffic</th>
                            <th className="p-4 text-right">Keywords</th>
                            <th className="p-4">Top Keywords</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-app-border">
                          {compareData.map((entry, i) => {
                            const isYou = !competitors.includes(entry.domain);
                            return (
                              <tr key={i} className="hover:bg-app-surface-raised transition-all duration-150">
                                <td className="p-4">
                                  <span className="text-xs font-semibold text-white flex items-center gap-2">
                                    {entry.domain}
                                    {isYou && (
                                      <Badge variant="info" className="px-1.5">
                                        You
                                      </Badge>
                                    )}
                                  </span>
                                  {entry.error && (
                                    <p className="text-2xs text-rose-400 mt-0.5">{entry.error}</p>
                                  )}
                                </td>
                                <td className="p-4 text-right font-mono tabular-nums text-xs">
                                  {entry.error ? '—' : formatNumber(entry.organicTrafficEstimate)}
                                </td>
                                <td className="p-4 text-right font-mono tabular-nums text-xs">
                                  {entry.error ? '—' : formatNumber(entry.organicKeywordCount)}
                                </td>
                                <td className="p-4 max-w-[200px]">
                                  <div className="flex flex-wrap gap-1">
                                    {entry.topKeywords.slice(0, 4).map((kw, ki) => (
                                      <Badge key={ki} variant="default" className="bg-app-base text-app-text-muted border-app-border rounded px-1.5">
                                        {kw.keyword}
                                      </Badge>
                                    ))}
                                    {entry.topKeywords.length > 4 && (
                                      <Badge variant="default" className="bg-app-base text-app-text-muted border-app-border rounded px-1.5">
                                        +{entry.topKeywords.length - 4}
                                      </Badge>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </>
              )}
            </div>
          )}

          {/* Tab: Keyword Gap */}
          {tab === 'keyword-gap' && (
            <div>
              {comparing ? (
                <Card>
                  <CardBody className="p-6 text-center">
                    <div className="space-y-2">
                      <div className="h-3 w-36 bg-app-surface-raised rounded animate-pulse mx-auto" />
                      <div className="h-3 w-28 bg-app-surface-raised rounded animate-pulse mx-auto" />
                    </div>
                  </CardBody>
                </Card>
              ) : keywordGap ? (
                <div className="space-y-6">
                  {/* Gap Opportunities (highest value — shown first) */}
                  {keywordGap.gapOpportunities.length > 0 && (
                    <div>
                      <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                        Gap Opportunities
                        <span className="text-2xs font-normal text-app-text-muted">({keywordGap.gapOpportunityCount})</span>
                        <span className="text-2xs text-app-text-muted font-normal ml-1">
                          — keywords all competitors rank for that you don't
                        </span>
                      </h3>
                      <Card className="overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm text-app-text">
                            <thead className="bg-app-base/80 text-app-text-muted uppercase font-semibold text-2xs border-b border-app-border">
                              <tr>
                                <th className="p-4">Keyword</th>
                                <th className="p-4 text-center">Competitors Ranking</th>
                                <th className="p-4">Ranked By</th>
                                <th className="p-4 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-app-border">
                              {keywordGap.gapOpportunities.map((entry, i) => (
                                <tr key={i} className="hover:bg-app-surface-raised transition-all duration-150">
                                  <td className="p-4 font-medium text-white text-xs">{entry.keyword}</td>
                                  <td className="p-4 text-center">
                                    <Badge variant="danger">
                                      {entry.rankCount}/{keywordGap.competitors.length}
                                    </Badge>
                                  </td>
                                  <td className="p-4 text-xs text-app-text-muted">
                                    <div className="flex flex-wrap gap-1">
                                      {entry.domains.map((d, di) => (
                                        <Badge key={di} variant="default" className="bg-app-base text-app-text-muted border-app-border rounded px-1.5">
                                          {d}
                                        </Badge>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="p-4 text-right">
                                    <Button
                                      onClick={() => handleTrackKeyword(entry.keyword)}
                                      disabled={trackingKeyword === entry.keyword}
                                      className="text-2xs px-3 py-1.5 shadow-none"
                                    >
                                      {trackingKeyword === entry.keyword ? '…' : 'Track'}
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    </div>
                  )}

                  {/* Partial Overlap */}
                  {keywordGap.partialOverlap.length > 0 && (
                    <div>
                      <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                        Partial Overlap
                        <span className="text-2xs font-normal text-app-text-muted">({keywordGap.partialOverlap.length})</span>
                        <span className="text-2xs text-app-text-muted font-normal ml-1">
                          — keywords some competitors rank for that you don't
                        </span>
                      </h3>
                      <Card className="overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm text-app-text">
                            <thead className="bg-app-base/80 text-app-text-muted uppercase font-semibold text-2xs border-b border-app-border">
                              <tr>
                                <th className="p-4">Keyword</th>
                                <th className="p-4 text-center">Competitors Ranking</th>
                                <th className="p-4">Ranked By</th>
                                <th className="p-4 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-app-border">
                              {keywordGap.partialOverlap.map((entry, i) => (
                                <tr key={i} className="hover:bg-app-surface-raised transition-all duration-150">
                                  <td className="p-4 font-medium text-white text-xs">{entry.keyword}</td>
                                  <td className="p-4 text-center">
                                    <Badge variant="warning">
                                      {entry.rankCount}/{keywordGap.competitors.length}
                                    </Badge>
                                  </td>
                                  <td className="p-4 text-xs text-app-text-muted">
                                    <div className="flex flex-wrap gap-1">
                                      {entry.domains.map((d, di) => (
                                        <Badge key={di} variant="default" className="bg-app-base text-app-text-muted border-app-border rounded px-1.5">
                                          {d}
                                        </Badge>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="p-4 text-right">
                                    <Button
                                      onClick={() => handleTrackKeyword(entry.keyword)}
                                      disabled={trackingKeyword === entry.keyword}
                                      className="text-2xs px-3 py-1.5 shadow-none"
                                    >
                                      {trackingKeyword === entry.keyword ? '…' : 'Track'}
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    </div>
                  )}

                  {/* Your Advantage */}
                  {keywordGap.yourAdvantage.length > 0 && (
                    <div>
                      <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                        Your Advantage
                        <span className="text-2xs font-normal text-app-text-muted">({keywordGap.yourAdvantage.length})</span>
                        <span className="text-2xs text-app-text-muted font-normal ml-1">
                          — keywords you rank for that no competitor does
                        </span>
                      </h3>
                      <Card>
                        <CardBody className="p-4">
                          <div className="flex flex-wrap gap-2">
                            {keywordGap.yourAdvantage.map((kw, i) => (
                              <Badge key={i} variant="success" className="text-xs px-2.5 py-1">
                                {kw}
                              </Badge>
                            ))}
                          </div>
                        </CardBody>
                      </Card>
                    </div>
                  )}

                  {keywordGap.gapOpportunities.length === 0 && keywordGap.partialOverlap.length === 0 && (
                    <EmptyState
                      title="No keyword gaps found"
                      description="No keyword gaps found against your competitors."
                    />
                  )}
                </div>
              ) : (
                <EmptyState
                  title="Add competitors to start"
                  description="Add competitors above to see keyword gap analysis."
                />
              )}
            </div>
          )}

          {/* Tab: Backlink Gap */}
          {tab === 'backlink-gap' && (
            <div>
              {comparing ? (
                <Card>
                  <CardBody className="p-6 text-center">
                    <div className="space-y-2">
                    <div className="h-3 w-40 bg-app-surface-raised rounded animate-pulse mx-auto" />
                    <div className="h-3 w-28 bg-app-surface-raised rounded animate-pulse mx-auto" />
                  </div>
                  </CardBody>
                </Card>
              ) : backlinkGap ? (
                <div>
                  <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    Link Opportunities
                    <span className="text-2xs font-normal text-app-text-muted">({backlinkGap.linkOpportunityCount})</span>
                    <span className="text-2xs text-app-text-muted font-normal ml-1">
                      — domains linking to competitors but not to you
                    </span>
                  </h3>

                  {backlinkGap.linkOpportunities.length === 0 ? (
                    <EmptyState
                      title="No link opportunities found"
                      description="All competitor backlinks already point to your domain."
                    />
                  ) : (
                    <Card className="overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-app-text">
                          <thead className="bg-app-base/80 text-app-text-muted uppercase font-semibold text-2xs border-b border-app-border">
                            <tr>
                              <th className="p-4">Referring Domain</th>
                              <th className="p-4 text-center">Linked By</th>
                              <th className="p-4">Competitors</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-app-border">
                            {backlinkGap.linkOpportunities.map((entry, i) => (
                              <tr key={i} className="hover:bg-app-surface-raised transition-all duration-150">
                                <td className="p-4 font-medium text-white text-xs">
                                  <a
                                    href={`https://${entry.domain}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-app-signal hover:text-app-signal/80 hover:underline"
                                  >
                                    {entry.domain}
                                  </a>
                                </td>
                                <td className="p-4 text-center">
                                  <Badge variant="success">
                                    {entry.linkedBy.length}/{backlinkGap.competitors.length}
                                  </Badge>
                                </td>
                                <td className="p-4 text-xs text-app-text-muted">
                                  <div className="flex flex-wrap gap-1">
                                    {entry.linkedBy.map((d, di) => (
                                      <Badge key={di} variant="default" className="bg-app-base text-slate-500 border-app-border rounded px-1.5">
                                        {d}
                                      </Badge>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}
                </div>
                  ) : (
                    <EmptyState
                      title="Add competitors to start"
                      description="Add competitors above to see backlink gap analysis."
                    />
                  )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
