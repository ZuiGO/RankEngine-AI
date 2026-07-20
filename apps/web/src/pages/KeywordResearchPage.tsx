import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Card, CardBody, Badge, Button, EmptyState } from '../components/ui';

interface KeywordResult {
  keyword: string;
  searchVolume: number;
  difficulty: number;
  cpc: number;
  intent: string;
}

interface RecentQuery {
  _id: string;
  seedKeyword: string;
  locationCode?: string;
  timestamp: string;
}

interface Project {
  _id: string;
  name: string;
  domain: string;
}

type SortField = 'searchVolume' | 'difficulty';
type SortOrder = 'asc' | 'desc';

const INTENT_STYLES: Record<string, string> = {
  informational: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  navigational: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
};

const INTENT_VARIANTS: Record<string, 'success' | 'warning' | 'default'> = {
  commercial: 'warning',
  transactional: 'success',
};

function difficultyVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score < 30) return 'success';
  if (score <= 60) return 'warning';
  return 'danger';
}

export default function KeywordResearchPage() {
  const { profile } = useAuth();

  const [seedKeyword, setSeedKeyword] = useState('');
  const [results, setResults] = useState<KeywordResult[]>([]);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recentSearches, setRecentSearches] = useState<RecentQuery[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [trackingKeyword, setTrackingKeyword] = useState<string | null>(null);
  const [pickerProject, setPickerProject] = useState<string>('');

  const quotaUsed = profile?.dataProviderCallsThisMonth ?? 0;
  const quotaLimit = profile?.dataProviderMonthlyLimit ?? 500;
  const quotaPct = quotaLimit > 0 ? Math.round((quotaUsed / quotaLimit) * 100) : 0;

  const fetchRecent = useCallback(async () => {
    try {
      const { data } = await api.get<{ queries: RecentQuery[] }>(
        '/keyword-research/history',
      );
      setRecentSearches(data.queries);
    } catch {
      // silently ignore
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const { data } = await api.get<Project[]>('/projects');
      setProjects(data);
      if (data.length > 0) setPickerProject(data[0]._id);
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    fetchRecent();
    fetchProjects();
  }, [fetchRecent, fetchProjects]);

  const handleSearch = async () => {
    const kw = seedKeyword.trim();
    if (!kw) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post<{
        seedKeyword: string;
        results: KeywordResult[];
      }>('/keyword-research', { seedKeyword: kw });
      setResults(data.results);
      setSortField(null);
      fetchRecent();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err.message || 'Search failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const sorted = [...results].sort((a, b) => {
    if (!sortField) return 0;
    const mul = sortOrder === 'desc' ? -1 : 1;
    return (a[sortField] - b[sortField]) * mul;
  });

  const handleTrack = async (kw: string) => {
    if (!pickerProject) return;
    setTrackingKeyword(kw);
    try {
      await api.post(`/projects/${pickerProject}/keywords`, {
        keyword: kw,
        targetUrl: '',
      });
    } catch {
      // silently ignore
    } finally {
      setTrackingKeyword(null);
    }
  };

  const handleClickRecent = (q: string) => {
    setSeedKeyword(q);
  };

  const formatNumber = (n: number) => n.toLocaleString();

  const sortArrow = (field: SortField) => {
    if (sortField !== field) return '';
    return sortOrder === 'desc' ? ' ↓' : ' ↑';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Quota bar */}
      <div className="flex items-center justify-end mb-4">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-medium text-slate-400">Quota</span>
          <div className="h-1.5 w-24 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                quotaPct >= 90
                  ? 'bg-rose-500'
                  : quotaPct >= 70
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
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

      {/* Hero search */}
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-white tracking-tight mb-2">
          Keyword Research
        </h1>
        <p className="text-slate-400 text-sm mb-6">
          Discover high-value keywords with search volume, difficulty, and CPC data.
        </p>
        <div className="max-w-2xl mx-auto flex items-center gap-2 bg-slate-900 border border-slate-700 focus-within:border-indigo-500 rounded-xl p-1.5 shadow-xl transition-all">
          <input
            type="text"
            value={seedKeyword}
            onChange={(e) => setSeedKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter a seed keyword, e.g. SEO tools..."
            className="flex-1 bg-transparent px-4 py-3 text-base text-white placeholder-slate-600 outline-none"
          />
          <Button
            onClick={handleSearch}
            disabled={loading || !seedKeyword.trim()}
            loading={loading}
            className="px-6 py-3"
          >
            {loading ? 'Searching…' : 'Search'}
          </Button>
        </div>
        {error && (
          <div className="mt-4 max-w-2xl mx-auto bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg">
            {error}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Main: Results table */}
        <div className="lg:col-span-8 space-y-6">
          {sorted.length > 0 && (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-300">
                  <thead className="bg-slate-950/80 text-slate-400 uppercase font-semibold text-2xs border-b border-slate-800">
                    <tr>
                      <th className="p-4 text-left">Keyword</th>
                      <th
                        className="p-4 text-right cursor-pointer hover:text-white transition-colors select-none"
                        onClick={() => handleSort('searchVolume')}
                      >
                        Volume{sortArrow('searchVolume')}
                      </th>
                      <th
                        className="p-4 text-right cursor-pointer hover:text-white transition-colors select-none"
                        onClick={() => handleSort('difficulty')}
                      >
                        Difficulty{sortArrow('difficulty')}
                      </th>
                      <th className="p-4 text-right">CPC</th>
                      <th className="p-4 text-center">Intent</th>
                      <th className="p-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {sorted.map((row, i) => (
                      <tr
                        key={i}
                        className="hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="p-4 font-medium text-white">{row.keyword}</td>
                        <td className="p-4 text-right font-mono tabular-nums text-slate-300">
                          {formatNumber(row.searchVolume)}
                        </td>
                        <td className="p-4 text-right">
                          <Badge variant={difficultyVariant(row.difficulty)} className="text-xs">
                            {row.difficulty}
                          </Badge>
                        </td>
                        <td className="p-4 text-right font-mono tabular-nums text-slate-300">
                          ${row.cpc.toFixed(2)}
                        </td>
                        <td className="p-4 text-center">
                          {row.intent ? (
                            <Badge
                              variant={INTENT_VARIANTS[row.intent.toLowerCase()] ?? 'default'}
                              className={`capitalize ${INTENT_STYLES[row.intent.toLowerCase()] ?? ''}`}
                            >
                              {row.intent}
                            </Badge>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {projects.length > 1 && (
                              <select
                                value={pickerProject}
                                onChange={(e) => setPickerProject(e.target.value)}
                                className="bg-slate-950 border border-slate-700 rounded-lg text-2xs px-2 py-1 text-slate-300 outline-none"
                              >
                                {projects.map((p) => (
                                  <option key={p._id} value={p._id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                            )}
                            <Button
                              onClick={() => handleTrack(row.keyword)}
                              disabled={trackingKeyword === row.keyword || !pickerProject}
                              className="text-2xs px-3 py-1.5"
                            >
                              {trackingKeyword === row.keyword ? '…' : 'Track'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {!loading && results.length === 0 && (
            <EmptyState
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              }
              title="Enter a seed keyword above to discover related terms with full SEO metrics."
            />
          )}
        </div>

        {/* Sidebar: Recent searches */}
        <div className="lg:col-span-4">
          {recentSearches.length > 0 && (
            <Card>
              <CardBody>
                <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Recent Searches
                </h3>
                <ul className="space-y-1">
                  {recentSearches.map((q) => (
                    <li key={q._id}>
                      <button
                        onClick={() => handleClickRecent(q.seedKeyword)}
                        className="w-full text-left text-xs text-slate-400 hover:text-white hover:bg-slate-800/50 rounded-lg px-3 py-2 transition-colors flex items-center justify-between gap-2"
                      >
                        <span className="truncate font-medium">{q.seedKeyword}</span>
                        <span className="text-2xs text-slate-600 tabular-nums flex-shrink-0">
                          {new Date(q.timestamp).toLocaleDateString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {/* Quick tip */}
          <Card className="bg-slate-900/50 border-slate-800/60 mt-6">
            <CardBody>
              <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-2">
                About the data
              </h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Search volume reflects monthly averages. Difficulty is a 0–100 score estimating how hard it is to rank in the top 10. CPC is the average cost-per-click for Google Ads.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
