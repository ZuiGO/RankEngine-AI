import { useState, useEffect, useCallback } from 'react';
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

interface BacklinkItem {
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  firstSeen: string;
  spamScore: number;
  toxic: boolean;
}

interface BacklinkListResponse {
  page: number;
  limit: number;
  items: BacklinkItem[];
}

interface Overview {
  totalBacklinks: number;
  referringDomains: number;
  authorityScore: number;
}

interface Snapshot {
  date: string;
  totalBacklinks: number;
  referringDomains: number;
  authorityScore: number;
}

export default function BacklinksPage() {
  const { id } = useParams<{ id: string }>();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [items, setItems] = useState<BacklinkItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState('');
  const [showToxicOnly, setShowToxicOnly] = useState(false);
  const limit = 50;

  const fetchOverview = useCallback(async () => {
    try {
      const { data } = await api.get<Overview>(
        `/projects/${id}/backlinks/overview`,
      );
      setOverview(data);
    } catch {
      // silently ignore — overview is non-critical
    }
  }, [id]);

  const fetchSnapshots = useCallback(async () => {
    try {
      const { data } = await api.get<Snapshot[]>(
        `/projects/${id}/backlinks/snapshots`,
      );
      setSnapshots(data);
    } catch {
      // silently ignore
    }
  }, [id]);

  const fetchList = useCallback(
    async (p: number) => {
      setListLoading(true);
      try {
        const { data } = await api.get<BacklinkListResponse>(
          `/projects/${id}/backlinks/list?page=${p}&limit=${limit}`,
        );
        setItems(data.items);
        setHasMore(data.items.length === limit);
      } catch (err: any) {
        const msg = err?.response?.data?.error || 'Failed to load backlinks';
        setError(msg);
      } finally {
        setListLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    if (!id) return;
    fetchOverview();
    fetchSnapshots();
    fetchList(1);
  }, [id, fetchOverview, fetchSnapshots, fetchList]);

  const handlePageChange = (p: number) => {
    if (p < 1) return;
    setPage(p);
    fetchList(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const filtered = showToxicOnly ? items.filter((i) => i.toxic) : items;

  const formatNumber = (n: number) => n.toLocaleString();

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
        <span className="text-slate-500 text-xs">Backlink Analysis</span>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <p className="text-2xs text-slate-400 uppercase font-semibold tracking-wider mb-1">
            Total Backlinks
          </p>
          <p className="text-2xl font-bold text-white tabular-nums">
            {overview ? formatNumber(overview.totalBacklinks) : '…'}
          </p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <p className="text-2xs text-slate-400 uppercase font-semibold tracking-wider mb-1">
            Referring Domains
          </p>
          <p className="text-2xl font-bold text-white tabular-nums">
            {overview ? formatNumber(overview.referringDomains) : '…'}
          </p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <p className="text-2xs text-slate-400 uppercase font-semibold tracking-wider mb-1">
            Authority Score
          </p>
          <p className="text-2xl font-bold text-white tabular-nums">
            {overview ? overview.authorityScore : '…'}
          </p>
          {overview && (
            <span
              className={`inline-block mt-1 text-2xs font-semibold px-2 py-0.5 rounded-full border ${
                overview.authorityScore >= 50
                  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                  : overview.authorityScore >= 30
                    ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                    : 'text-rose-500 bg-rose-500/10 border-rose-500/20'
              }`}
            >
              {overview.authorityScore >= 50
                ? 'Strong'
                : overview.authorityScore >= 30
                  ? 'Moderate'
                  : 'Weak'}
            </span>
          )}
        </div>
      </div>

      {/* Trend chart */}
      {snapshots.length > 1 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl mb-8">
          <h3 className="text-sm font-bold text-white mb-4">Backlink Growth</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={snapshots}
                margin={{ top: 5, right: 10, left: -20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <Line
                  type="monotone"
                  dataKey="totalBacklinks"
                  stroke="#818cf8"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#818cf8' }}
                  name="Total Backlinks"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Explainer */}
      <div className="bg-indigo-950/30 border border-indigo-800/20 rounded-2xl p-4 mb-6">
        <p className="text-xs text-slate-400 leading-relaxed">
          <span className="text-indigo-400 font-semibold">Backlinks</span> are
          links from other sites to yours — search engines treat them as trust
          signals, but spammy ones can hurt more than help.
        </p>
      </div>

      {/* Table header + filter */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-white">
          {showToxicOnly ? 'Toxic Backlinks' : 'All Backlinks'}
        </h3>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-2xs text-slate-400 font-medium">
            Show toxic links only
          </span>
          <div
            className={`relative w-8 h-4 rounded-full transition-colors ${
              showToxicOnly ? 'bg-rose-500' : 'bg-slate-700'
            }`}
            onClick={() => setShowToxicOnly((v) => !v)}
          >
            <div
              className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                showToxicOnly ? 'translate-x-4' : ''
              }`}
            />
          </div>
        </label>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 uppercase font-semibold text-2xs border-b border-slate-800">
              <tr>
                <th className="p-4">Source</th>
                <th className="p-4">Anchor Text</th>
                <th className="p-4">First Seen</th>
                <th className="p-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {listLoading && items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-500 text-xs">
                    Loading backlinks…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-500 text-xs">
                    {showToxicOnly
                      ? 'No toxic backlinks found.'
                      : 'No backlinks found for this project.'}
                  </td>
                </tr>
              ) : (
                filtered.map((item, i) => (
                  <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                    <td className="p-4 max-w-xs">
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:text-indigo-300 font-medium text-xs truncate block hover:underline"
                      >
                        {item.sourceUrl}
                      </a>
                    </td>
                    <td className="p-4 text-xs text-slate-400 max-w-[200px] truncate">
                      {item.anchorText}
                    </td>
                    <td className="p-4 text-xs text-slate-500 font-mono tabular-nums">
                      {item.firstSeen || '—'}
                    </td>
                    <td className="p-4 text-center">
                      {item.toxic ? (
                        <span className="inline-block bg-rose-500/10 border border-rose-500/20 text-rose-400 text-2xs font-semibold px-2.5 py-0.5 rounded-full">
                          Toxic
                        </span>
                      ) : (
                        <span className="inline-block bg-emerald-500/5 border border-emerald-500/10 text-emerald-500 text-2xs font-semibold px-2.5 py-0.5 rounded-full">
                          Clean
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {!showToxicOnly && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-2xs text-slate-500">
            Page {page}
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => handlePageChange(page - 1)}
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              Previous
            </button>
            <span className="text-2xs text-slate-600 tabular-nums">{page}</span>
            <button
              disabled={!hasMore}
              onClick={() => handlePageChange(page + 1)}
              className="bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
