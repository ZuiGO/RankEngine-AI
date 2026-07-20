import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import api from '../lib/api';
import { Card, CardBody, Badge } from '../components/ui';

interface TrackedKeywordData {
  _id: string;
  keyword: string;
  targetUrl: string;
  competitorDomains: string[];
  currentPosition: number;
  aioPresence: boolean;
  trend: 'up' | 'down' | 'stable';
  history7Days: { position: number; date: string }[];
}

interface HistoricalSnap {
  position: number;
  aioPresence: boolean;
  date: string;
}

export default function KeywordsPage() {
  const { id } = useParams<{ id: string }>();

  const [keywords, setKeywords] = useState<TrackedKeywordData[]>([]);
  const [keyword, setKeyword] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [competitors, setCompetitors] = useState('');

  const [selectedKeywordId, setSelectedKeywordId] = useState<string | null>(null);
  const [selectedKeywordName, setSelectedKeywordName] = useState<string>('');
  const [history, setHistory] = useState<HistoricalSnap[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [suggestedKeywords, setSuggestedKeywords] = useState<{ keyword: string; source: string }[]>([]);
  const [trackingKeyword, setTrackingKeyword] = useState<string | null>(null);

  const fetchSuggestedKeywords = async () => {
    try {
      const { data } = await api.get<{ keyword: string; source: string }[]>(
        `/projects/${id}/suggested-keywords`,
      );
      setSuggestedKeywords(data);
    } catch {
      //
    }
  };

  const handleTrackSuggested = async (kw: string) => {
    setTrackingKeyword(kw);
    try {
      const { data: project } = await api.get<{ domain: string }>(`/projects/${id}`);
      const homepageUrl = project.domain?.startsWith('http') ? project.domain : `https://${project.domain}`;

      await api.post(`/projects/${id}/keywords`, { keyword: kw, targetUrl: homepageUrl });
      setSuccess(`Now tracking "${kw}"!`);
      fetchKeywords();
      fetchSuggestedKeywords();
    } catch {
      //
    } finally {
      setTrackingKeyword(null);
    }
  };

  const fetchKeywords = async () => {
    try {
      const { data } = await api.get<TrackedKeywordData[]>(`/projects/${id}/keywords`);
      setKeywords(data);
      if (data.length > 0 && !selectedKeywordId) {
        setSelectedKeywordId(data[0]._id);
        setSelectedKeywordName(data[0].keyword);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async (keywordId: string) => {
    setLoadingHistory(true);
    try {
      const { data } = await api.get<{ history: HistoricalSnap[] }>(
        `/projects/${id}/keywords/${keywordId}/history`,
      );
      setHistory(data.history || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    fetchKeywords();
    fetchSuggestedKeywords();
  }, [id]);

  useEffect(() => {
    if (selectedKeywordId) {
      fetchHistory(selectedKeywordId);
    }
  }, [selectedKeywordId]);

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);

    const competitorList = competitors
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    try {
      const { data } = await api.post<{ keyword: string }>(`/projects/${id}/keywords`, {
        keyword,
        targetUrl,
        competitorDomains: competitorList,
      });
      setKeyword('');
      setTargetUrl('');
      setCompetitors('');
      setSuccess(`Successfully tracking "${data.keyword}"!`);
      fetchKeywords();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to track keyword');
    } finally {
      setSubmitting(false);
    }
  };

  const getPositionText = (pos: number) => {
    return pos === 101 ? 'Unranked' : `#${pos}`;
  };

  const getTrendIcon = (trend: 'up' | 'down' | 'stable') => {
    if (trend === 'up') return <span className="text-emerald-400 font-bold">↑ Up</span>;
    if (trend === 'down') return <span className="text-rose-500 font-bold">↓ Down</span>;
    return <span className="text-slate-500">→ Stable</span>;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <Link
          to="/"
          className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center space-x-1 transition-colors"
        >
          <span>← Back to Dashboard</span>
        </Link>
        <span className="text-slate-500 text-xs">Keyword Rank Monitor</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 space-y-6">
          <Card>
            <CardBody>
            <h3 className="text-sm font-bold text-white mb-4">Track New Keyword</h3>
            {error && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-4">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs p-3 rounded-lg mb-4">
                {success}
              </div>
            )}
            <form onSubmit={handleAddKeyword} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <div>
                <label className="block text-2xs font-semibold text-slate-400 mb-1">Keyword</label>
                <input
                  type="text"
                  required
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs px-3 py-1.5 text-white placeholder-slate-700 outline-none transition-all font-semibold"
                  placeholder="e.g. best seo tools"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-2xs font-semibold text-slate-400 mb-1">Target Page URL</label>
                <input
                  type="url"
                  required
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs px-3 py-1.5 text-white placeholder-slate-700 outline-none transition-all font-semibold"
                  placeholder="e.g. https://site.com/blog"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                />
              </div>
              <div className="flex space-x-2">
                <div className="flex-1">
                  <label className="block text-2xs font-semibold text-slate-400 mb-1">Competitors (CSV)</label>
                  <input
                    type="text"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs px-3 py-1.5 text-white placeholder-slate-700 outline-none transition-all"
                    placeholder="comp1.com, comp2.com"
                    value={competitors}
                    onChange={(e) => setCompetitors(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-colors h-[32px] mt-auto cursor-pointer"
                >
                  Track
                </button>
              </div>
            </form>
            </CardBody>
          </Card>

          {suggestedKeywords.length > 0 && (
            <Card className="border-indigo-800/30">
            <CardBody>
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Suggested for you
              </h3>
              <div className="flex flex-wrap gap-2">
                {suggestedKeywords.map((sk, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs"
                  >
                    <span className="text-slate-200 font-medium">{sk.keyword}</span>
                    <button
                      onClick={() => handleTrackSuggested(sk.keyword)}
                      disabled={trackingKeyword === sk.keyword}
                      className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-semibold px-2 py-1 rounded-md transition-colors"
                    >
                      {trackingKeyword === sk.keyword ? 'Adding…' : 'Track'}
                    </button>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
          )}

          <Card className="overflow-hidden">
            <CardBody>
            <h3 className="text-sm font-bold text-white mb-4">Tracked Search Keywords</h3>
            {loading ? (
              <p className="text-slate-500 text-xs">Loading tracked keywords...</p>
            ) : keywords.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-slate-400 text-sm mb-2">No keywords tracked yet</p>
                <p className="text-slate-500 text-xs max-w-sm mx-auto">
                  Add keywords above to monitor your daily ranking positions. You can also check the <span className="text-indigo-400">Suggested for you</span> section — these are terms pulled from your latest audit that your pages already mention.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950/80 text-slate-400 uppercase font-semibold text-2xs border-b border-slate-850">
                    <tr>
                      <th className="p-3">Keyword</th>
                      <th className="p-3">Position</th>
                      <th className="p-3">7-Day Trend</th>
                      <th className="p-3">AI Overview</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {keywords.map((kw) => (
                      <tr
                        key={kw._id}
                        className={`hover:bg-slate-850/40 transition-colors cursor-pointer ${
                          selectedKeywordId === kw._id ? 'bg-indigo-600/5 text-white font-bold' : ''
                        }`}
                        onClick={() => {
                          setSelectedKeywordId(kw._id);
                          setSelectedKeywordName(kw.keyword);
                        }}
                      >
                        <td className="p-3 font-semibold">{kw.keyword}</td>
                        <td className="p-3 font-mono">{getPositionText(kw.currentPosition)}</td>
                        <td className="p-3">{getTrendIcon(kw.trend)}</td>
                        <td className="p-3">
                          {kw.aioPresence ? (
                            <Badge variant="success" className="animate-pulse">
                              In AI Overview
                            </Badge>
                          ) : (
                            <span className="bg-slate-950 border border-slate-850 text-slate-500 text-2xs px-2 py-0.5 rounded-full">
                              No AIO Links
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            className="text-xs text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedKeywordId(kw._id);
                              setSelectedKeywordName(kw.keyword);
                            }}
                          >
                            Chart History
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </CardBody>
          </Card>
        </div>

        <div className="lg:col-span-5">
          <Card className="p-6 relative min-h-[400px]">
            <h3 className="text-sm font-bold text-white mb-6">
              30-Day Ranking Chart {selectedKeywordName && `: "${selectedKeywordName}"`}
            </h3>

            {loadingHistory ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 rounded-2xl">
                <span className="text-slate-400 text-xs">Loading chart snapshots...</span>
              </div>
            ) : !selectedKeywordId ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-slate-500 text-xs">Select a keyword to view rank history</span>
              </div>
            ) : history.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-slate-500 text-xs">No historical snaps found for this keyword yet.</span>
              </div>
            ) : (
              <div className="h-64 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="date"
                      stroke="#64748b"
                      tickFormatter={(d) => d.slice(5)}
                      style={{ fontSize: '10px' }}
                    />
                    <YAxis
                      reversed
                      domain={[1, 101]}
                      stroke="#64748b"
                      tickFormatter={(r) => (r === 101 ? 'UR' : r)}
                      style={{ fontSize: '10px' }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                      labelStyle={{ color: '#94a3b8', fontWeight: 'bold', fontSize: '11px' }}
                      itemStyle={{ color: '#fff', fontSize: '11px' }}
                      formatter={(value: any, _name: any, item: any) => {
                        const valNum = Number(value);
                        const label = valNum === 101 ? 'Unranked' : `#${valNum}`;
                        const suffix = item?.payload?.aioPresence ? ' (AI Overview)' : '';
                        return [`${label}${suffix}`, 'Rank Position'] as any;
                      }}
                    />
                    <Line
                      name="Rank Position"
                      type="monotone"
                      dataKey="position"
                      stroke="#6366f1"
                      strokeWidth={2.5}
                      dot={{ r: 4, stroke: '#818cf8', strokeWidth: 1 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <div className="flex justify-between items-center text-2xs text-slate-500 mt-4 px-2">
                  <span>Note: Y-axis is inverted (lower numbers = higher rank).</span>
                  <span>UR = Unranked (101)</span>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
