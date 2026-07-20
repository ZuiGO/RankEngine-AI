import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';
import { Card, CardBody, StatGauge } from '../components/ui';

// ── Types ──────────────────────────────────────────────────────────────────

interface SnapshotEntry {
  mentioned: boolean;
  mentionContext: string;
  checkedAt: string;
}

interface TrackedPrompt {
  _id: string;
  projectId: string;
  promptText: string;
  brandTerm: string;
  createdAt: string;
  latestSnapshots: Record<string, SnapshotEntry>;
}

interface AiVisibilityResponse {
  prompts: TrackedPrompt[];
  visibilityScore: number;
  totalChecks: number;
  totalMentions: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const ENGINES: { key: string; label: string }[] = [
  { key: 'chatgpt', label: 'ChatGPT' },
  { key: 'gemini', label: 'Gemini' },
  { key: 'perplexity', label: 'Perplexity' },
  { key: 'google_aio', label: 'Google AI Overview' },
];

// ── Component ──────────────────────────────────────────────────────────────

export default function AiVisibilityPage() {
  const { id } = useParams<{ id: string }>();

  const [data, setData] = useState<AiVisibilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form state
  const [promptText, setPromptText] = useState('');
  const [brandTerm, setBrandTerm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Expanded row context
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [visRes, projRes] = await Promise.all([
        api.get<AiVisibilityResponse>(`/projects/${id}/ai-visibility`),
        api.get<{ domain: string }>(`/projects/${id}`),
      ]);
      setData(visRes.data);
      setBrandTerm(projRes.data.domain);
    } catch {
      setError('Failed to load AI visibility data.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !promptText.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/projects/${id}/ai-visibility/prompts`, {
        promptText: promptText.trim(),
        brandTerm: brandTerm.trim().toLowerCase(),
      });
      setPromptText('');
      fetchData();
    } catch {
      setError('Failed to add prompt.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <p className="text-slate-400 text-sm">Loading AI visibility data…</p>
      </div>
    );
  }

  const score = data?.visibilityScore ?? 0;

  const prompts = data?.prompts ?? [];

  // Per-engine stats
  const engineStats = ENGINES.map((eng) => {
    let total = 0;
    let mentioned = 0;
    for (const p of prompts) {
      const snap = p.latestSnapshots[eng.key];
      if (snap) {
        total++;
        if (snap.mentioned) mentioned++;
      }
    }
    return { ...eng, total, mentioned };
  });

  const toggleRow = (promptId: string) => {
    setExpandedRow((prev) => (prev === promptId ? null : promptId));
  };

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
        <span className="text-slate-500 text-xs">AI Visibility</span>
      </div>

      {/* Explainer */}
      <div className="bg-indigo-950/30 border border-indigo-800/20 rounded-2xl p-4 mb-8">
        <p className="text-xs text-slate-400 leading-relaxed">
          <span className="text-indigo-400 font-semibold">AI Visibility</span> tracks
          whether AI assistants mention your brand when people ask relevant questions —
          the new frontier beyond traditional search rankings.
        </p>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Score + engine breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <StatGauge score={score} size={112} label="Visibility">
          <p className="text-base font-bold text-white">AI Visibility Score</p>
          <p className="text-xs mt-1">
            {score >= 80 ? 'Your brand is well represented across AI platforms.' :
             score >= 50 ? 'Moderate AI presence — opportunities to improve.' :
             'Low AI visibility — consider adding more content that AI assistants can reference.'}
          </p>
        </StatGauge>

        {engineStats.map((eng) => {
          const pct = eng.total > 0 ? Math.round((eng.mentioned / eng.total) * 100) : 0;
          return (
            <Card key={eng.key} className="p-5">
              <CardBody>
                <p className="text-xs text-slate-400 uppercase font-semibold tracking-wider mb-2">
                  {eng.label}
                </p>
                <p className="text-2xl font-bold tabular-nums text-white">
                  {eng.mentioned}
                  <span className="text-slate-500 text-base font-normal"> / {eng.total}</span>
                </p>
                <div className="mt-2 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : pct === 0 ? 'bg-slate-700' : 'bg-rose-500'}`}
                    style={{ width: `${eng.total > 0 ? pct : 0}%` }}
                  />
                </div>
                <p className="text-2xs text-slate-500 mt-1">{pct}% mention rate</p>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Add prompt form */}
      <Card className="p-5 mb-8">
        <h3 className="text-sm font-bold text-white mb-4">Track a New Prompt</h3>
        <form onSubmit={handleAddPrompt} className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-2xs font-semibold text-slate-400 mb-1">Prompt</label>
            <input
              type="text"
              required
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder='e.g. "best project management software for small teams"'
              className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs px-3 py-2 text-white placeholder-slate-700 outline-none transition-all"
            />
          </div>
          <div className="w-full sm:w-48">
            <label className="block text-2xs font-semibold text-slate-400 mb-1">Brand Term</label>
            <input
              type="text"
              required
              value={brandTerm}
              onChange={(e) => setBrandTerm(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs px-3 py-2 text-white placeholder-slate-700 outline-none transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !promptText.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs px-5 py-2 rounded-lg transition-colors h-[34px] flex-shrink-0"
          >
            {submitting ? 'Adding…' : 'Add Prompt'}
          </button>
        </form>
      </Card>

      {/* Tracked prompts table */}
      <h3 className="text-sm font-bold text-white mb-4">
        Tracked Prompts {prompts.length > 0 && <span className="text-slate-500 font-normal">({prompts.length})</span>}
      </h3>

      {prompts.length === 0 ? (
        <Card className="p-8">
          <CardBody className="text-center">
            <p className="text-slate-500 text-sm">No prompts tracked yet. Add one above to start monitoring AI visibility.</p>
          </CardBody>
        </Card>
      ) : (
        <Card className="shadow-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-950/80 text-slate-400 uppercase font-semibold text-2xs border-b border-slate-800">
                <tr>
                  <th className="p-4">Prompt</th>
                  <th className="p-4">Brand Term</th>
                  {ENGINES.map((eng) => (
                    <th key={eng.key} className="p-4 text-center">{eng.label}</th>
                  ))}
                  <th className="p-4 text-center">Context</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {prompts.map((prompt) => {
                  const isExpanded = expandedRow === prompt._id;
                  return (
                    <tr key={prompt._id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="p-4 max-w-[260px]">
                        <p className="text-xs text-white font-medium truncate" title={prompt.promptText}>
                          {prompt.promptText}
                        </p>
                        <p className="text-2xs text-slate-600 mt-0.5">
                          {new Date(prompt.createdAt).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="p-4 text-xs text-slate-400 font-mono">{prompt.brandTerm}</td>
                      {ENGINES.map((eng) => {
                        const snap = prompt.latestSnapshots[eng.key];
                        const hasCheck = !!snap;
                        return (
                          <td key={eng.key} className="p-4 text-center">
                            {hasCheck ? (
                              snap.mentioned ? (
                                <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-500/10 text-emerald-400" title={`Mentioned: ${snap.mentionContext}`}>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-rose-500/10 text-rose-400" title={`Not mentioned`}>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </span>
                              )
                            ) : (
                              <span className="text-slate-600 text-2xs">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-4 text-center">
                        <button
                          onClick={() => toggleRow(prompt._id)}
                          className="text-2xs text-indigo-400 hover:text-indigo-300 font-semibold transition-colors"
                        >
                          {isExpanded ? 'Hide' : 'View context'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Expandable context rows */}
            {prompts.map((prompt) => {
              if (expandedRow !== prompt._id) return null;
              const hasAnyContext = ENGINES.some((eng) => {
                const snap = prompt.latestSnapshots[eng.key];
                return snap?.mentioned && snap.mentionContext;
              });
              if (!hasAnyContext) {
                return (
                  <div key={`ctx-${prompt._id}`} className="px-4 pb-4">
                    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
                      <p className="text-xs text-slate-500 italic">No mention context available for this prompt.</p>
                    </div>
                  </div>
                );
              }
              return (
                <div key={`ctx-${prompt._id}`} className="px-4 pb-4 space-y-2">
                  {ENGINES.map((eng) => {
                    const snap = prompt.latestSnapshots[eng.key];
                    if (!snap?.mentioned || !snap.mentionContext) return null;
                    return (
                      <div key={eng.key} className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                        <p className="text-2xs font-semibold text-indigo-400 mb-1 uppercase tracking-wider">{eng.label}</p>
                        <p className="text-xs text-slate-300 leading-relaxed">{snap.mentionContext}</p>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
