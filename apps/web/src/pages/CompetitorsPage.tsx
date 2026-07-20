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
import { useAuth } from '../context/AuthContext';
import { Card, CardBody, Badge, Button } from '../components/ui';

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
  const { profile } = useAuth();

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

  const quotaUsed = profile?.dataProviderCallsThisMonth ?? 0;
  const quotaLimit = profile?.dataProviderMonthlyLimit ?? 500;
  const quotaPct = quotaLimit > 0 ? Math.round((quotaUsed / quotaLimit) * 100) : 0;

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
        <p className="text-slate-400 text-sm">Loading competitor data…</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between mb-6">
        <Link
          to={`/projects/${id}`}
          className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Project
        </Link>

        {/* Quota */}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-medium text-slate-400">Quota</span>
          <div className="h-1.5 w-24 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                quotaPct >= 90 ? 'bg-rose-500' : quotaPct >= 70 ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
              style={{ width: `${Math.min(quotaPct, 100)}%` }}
            />
          </div>
          <span className="font-mono tabular-nums">
            <span className="text-slate-300">{quotaUsed}</span>
            {' / '}
            <span className="text-slate-500">{quotaLimit}</span>
          </span>
        </div>
      </div>

      {/* Explainer */}
      <div className="bg-indigo-950/30 border border-indigo-800/20 rounded-2xl p-4 mb-8">
        <p className="text-xs text-slate-400 leading-relaxed">
          <span className="text-indigo-400 font-semibold">Competitor Analysis</span> compares
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
              <span className="text-indigo-400 font-mono text-xs">{projectInfo?.domain ?? id}</span>
            </h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-2xs text-slate-400 uppercase font-semibold tracking-wider mb-1">
                  Traffic Estimate
                </p>
                <p className="text-2xl font-bold text-white tabular-nums">
                  {overview ? formatNumber(overview.organicTrafficEstimate) : '…'}
                </p>
              </div>
              <div>
                <p className="text-2xs text-slate-400 uppercase font-semibold tracking-wider mb-1">
                  Keyword Count
                </p>
                <p className="text-2xl font-bold text-white tabular-nums">
                  {overview ? formatNumber(overview.organicKeywordCount) : '…'}
                </p>
              </div>
            </div>
            {overview && overview.topKeywords.length > 0 && (
              <div>
                <p className="text-2xs text-slate-400 uppercase font-semibold tracking-wider mb-1.5">
                  Top Keywords
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {overview.topKeywords.slice(0, 8).map((kw, i) => (
                    <Badge key={i} variant="default" className="bg-slate-950 rounded-md font-mono px-2">
                      {kw.keyword}
                      {kw.position != null && (
                        <span className="text-slate-600 ml-1">#{kw.position}</span>
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
                className="flex-1 bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs px-3 py-2 text-white placeholder-slate-700 outline-none transition-all"
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
                    className="inline-flex items-center gap-1.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-2xs font-semibold px-2.5 py-1 rounded-full"
                  >
                    {c}
                    <button onClick={() => handleRemoveCompetitor(c)} className="hover:text-white transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
                {competitors.length < 5 && (
                  <span className="text-2xs text-slate-600 self-center">
                    {5 - competitors.length} slot{5 - competitors.length !== 1 ? 's' : ''} remaining
                  </span>
                )}
              </div>
            )}
            {competitors.length === 0 && (
              <p className="text-2xs text-slate-600 mt-1">
                Add up to 5 competitor domains to start a gap analysis.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Tabs */}
      {compareData.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-1 border-b border-slate-800 mb-6">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`text-xs font-semibold px-4 py-2.5 transition-colors border-b-2 -mb-[1px] ${
                  tab === t.key
                    ? 'text-indigo-400 border-indigo-400'
                    : 'text-slate-500 border-transparent hover:text-slate-300'
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
                    <p className="text-slate-400 text-xs">Running gap analysis…</p>
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
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis
                              dataKey="domain"
                              stroke="#64748b"
                              tick={{ fontSize: 10 }}
                              tickFormatter={(v: string) => {
                                const p = projectInfo?.domain ?? '';
                                return v === p ? 'You' : v.replace(/\.[^.]+$/, '');
                              }}
                            />
                            <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumber(Number(v))} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                              labelStyle={{ color: '#94a3b8' }}
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
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis
                              dataKey="domain"
                              stroke="#64748b"
                              tick={{ fontSize: 10 }}
                              tickFormatter={(v: string) => {
                                const p = projectInfo?.domain ?? '';
                                return v === p ? 'You' : v.replace(/\.[^.]+$/, '');
                              }}
                            />
                            <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => formatNumber(Number(v))} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                              labelStyle={{ color: '#94a3b8' }}
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
                      <table className="w-full text-left text-sm text-slate-300">
                        <thead className="bg-slate-950/80 text-slate-400 uppercase font-semibold text-2xs border-b border-slate-800">
                          <tr>
                            <th className="p-4">Domain</th>
                            <th className="p-4 text-right">Traffic</th>
                            <th className="p-4 text-right">Keywords</th>
                            <th className="p-4">Top Keywords</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {compareData.map((entry, i) => {
                            const isYou = !competitors.includes(entry.domain);
                            return (
                              <tr key={i} className="hover:bg-slate-800/30 transition-colors">
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
                                      <Badge key={ki} variant="default" className="bg-slate-950 text-slate-400 border-slate-800 rounded px-1.5">
                                        {kw.keyword}
                                      </Badge>
                                    ))}
                                    {entry.topKeywords.length > 4 && (
                                      <Badge variant="default" className="bg-slate-950 text-slate-600 border-slate-800 rounded px-1.5">
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
                    <p className="text-slate-400 text-xs">Analyzing keyword gaps…</p>
                  </CardBody>
                </Card>
              ) : keywordGap ? (
                <div className="space-y-6">
                  {/* Gap Opportunities (highest value — shown first) */}
                  {keywordGap.gapOpportunities.length > 0 && (
                    <div>
                      <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                        Gap Opportunities
                        <span className="text-2xs font-normal text-slate-500">({keywordGap.gapOpportunityCount})</span>
                        <span className="text-2xs text-slate-500 font-normal ml-1">
                          — keywords all competitors rank for that you don't
                        </span>
                      </h3>
                      <Card className="overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm text-slate-300">
                            <thead className="bg-slate-950/80 text-slate-400 uppercase font-semibold text-2xs border-b border-slate-800">
                              <tr>
                                <th className="p-4">Keyword</th>
                                <th className="p-4 text-center">Competitors Ranking</th>
                                <th className="p-4">Ranked By</th>
                                <th className="p-4 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {keywordGap.gapOpportunities.map((entry, i) => (
                                <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                                  <td className="p-4 font-medium text-white text-xs">{entry.keyword}</td>
                                  <td className="p-4 text-center">
                                    <Badge variant="danger">
                                      {entry.rankCount}/{keywordGap.competitors.length}
                                    </Badge>
                                  </td>
                                  <td className="p-4 text-xs text-slate-400">
                                    <div className="flex flex-wrap gap-1">
                                      {entry.domains.map((d, di) => (
                                        <Badge key={di} variant="default" className="bg-slate-950 text-slate-500 border-slate-800 rounded px-1.5">
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
                        <span className="text-2xs font-normal text-slate-500">({keywordGap.partialOverlap.length})</span>
                        <span className="text-2xs text-slate-500 font-normal ml-1">
                          — keywords some competitors rank for that you don't
                        </span>
                      </h3>
                      <Card className="overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm text-slate-300">
                            <thead className="bg-slate-950/80 text-slate-400 uppercase font-semibold text-2xs border-b border-slate-800">
                              <tr>
                                <th className="p-4">Keyword</th>
                                <th className="p-4 text-center">Competitors Ranking</th>
                                <th className="p-4">Ranked By</th>
                                <th className="p-4 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {keywordGap.partialOverlap.map((entry, i) => (
                                <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                                  <td className="p-4 font-medium text-white text-xs">{entry.keyword}</td>
                                  <td className="p-4 text-center">
                                    <Badge variant="warning">
                                      {entry.rankCount}/{keywordGap.competitors.length}
                                    </Badge>
                                  </td>
                                  <td className="p-4 text-xs text-slate-400">
                                    <div className="flex flex-wrap gap-1">
                                      {entry.domains.map((d, di) => (
                                        <Badge key={di} variant="default" className="bg-slate-950 text-slate-500 border-slate-800 rounded px-1.5">
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
                        <span className="text-2xs font-normal text-slate-500">({keywordGap.yourAdvantage.length})</span>
                        <span className="text-2xs text-slate-500 font-normal ml-1">
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
                    <Card>
                      <CardBody className="p-8 text-center">
                        <p className="text-slate-500 text-sm">
                          No keyword gaps found against your competitors.
                        </p>
                      </CardBody>
                    </Card>
                  )}
                </div>
              ) : (
                <Card>
                  <CardBody className="p-8 text-center">
                    <p className="text-slate-500 text-sm">
                      Add competitors above to see keyword gap analysis.
                    </p>
                  </CardBody>
                </Card>
              )}
            </div>
          )}

          {/* Tab: Backlink Gap */}
          {tab === 'backlink-gap' && (
            <div>
              {comparing ? (
                <Card>
                  <CardBody className="p-6 text-center">
                    <p className="text-slate-400 text-xs">Analyzing backlink gaps…</p>
                  </CardBody>
                </Card>
              ) : backlinkGap ? (
                <div>
                  <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    Link Opportunities
                    <span className="text-2xs font-normal text-slate-500">({backlinkGap.linkOpportunityCount})</span>
                    <span className="text-2xs text-slate-500 font-normal ml-1">
                      — domains linking to competitors but not to you
                    </span>
                  </h3>

                  {backlinkGap.linkOpportunities.length === 0 ? (
                    <Card>
                      <CardBody className="p-8 text-center">
                        <p className="text-slate-500 text-sm">
                          No link opportunities found. All competitor backlinks already point to your domain.
                        </p>
                      </CardBody>
                    </Card>
                  ) : (
                    <Card className="overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-slate-300">
                          <thead className="bg-slate-950/80 text-slate-400 uppercase font-semibold text-2xs border-b border-slate-800">
                            <tr>
                              <th className="p-4">Referring Domain</th>
                              <th className="p-4 text-center">Linked By</th>
                              <th className="p-4">Competitors</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {backlinkGap.linkOpportunities.map((entry, i) => (
                              <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                                <td className="p-4 font-medium text-white text-xs">
                                  <a
                                    href={`https://${entry.domain}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-indigo-400 hover:text-indigo-300 hover:underline"
                                  >
                                    {entry.domain}
                                  </a>
                                </td>
                                <td className="p-4 text-center">
                                  <Badge variant="success">
                                    {entry.linkedBy.length}/{backlinkGap.competitors.length}
                                  </Badge>
                                </td>
                                <td className="p-4 text-xs text-slate-400">
                                  <div className="flex flex-wrap gap-1">
                                    {entry.linkedBy.map((d, di) => (
                                      <Badge key={di} variant="default" className="bg-slate-950 text-slate-500 border-slate-800 rounded px-1.5">
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
                <Card>
                  <CardBody className="p-8 text-center">
                    <p className="text-slate-500 text-sm">
                      Add competitors above to see backlink gap analysis.
                    </p>
                  </CardBody>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
