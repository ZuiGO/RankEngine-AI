import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Layers, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../lib/api';
import { Card, Badge, EmptyState } from '../components/ui';

interface Cluster {
  name: string;
  description: string;
  keywords: string[];
  searchIntent: string;
  relevance: number;
}

export default function KeywordClusteringPage() {
  const { id } = useParams<{ id: string }>();
  const [keywordsText, setKeywordsText] = useState('');
  const [maxClusters, setMaxClusters] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [unassigned, setUnassigned] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleExpanded = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleCluster = async () => {
    const keywords = keywordsText.split('\n').map((k) => k.trim()).filter(Boolean);
    if (keywords.length < 2) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post(`/projects/${id}/keywords/cluster`, {
        keywords,
        maxClusters,
      });
      setClusters(data.clusters || []);
      setUnassigned(data.unassigned || []);
      setExpanded(new Set(data.clusters?.length ? [0] : []));
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Clustering failed');
    } finally {
      setLoading(false);
    }
  };

  const totalKeywords = clusters.reduce((sum, c) => sum + c.keywords.length, 0) + unassigned.length;

  const intentColor = (intent: string) => {
    switch (intent) {
      case 'informational': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'commercial': return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'transactional': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'navigational': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      default: return 'bg-app-surface text-app-text border-app-border';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <Link to={`/projects/${id}`} className="text-xs text-app-signal hover:text-app-signal/80 font-semibold flex items-center space-x-1">
          <span>← Back to Project</span>
        </Link>
        <span className="text-app-text-muted text-xs">Keyword Clustering</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 space-y-6">
          <Card className="p-5">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Layers className="h-4 w-4 text-app-signal" />
              Input Keywords
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-app-text-muted mb-1.5">Keywords (one per line)</label>
                <textarea
                  value={keywordsText}
                  onChange={(e) => setKeywordsText(e.target.value)}
                  placeholder="on-page seo&#10;meta tags optimization&#10;heading structure seo&#10;internal linking strategy&#10;keyword research tools"
                  rows={10}
                  className="w-full bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3.5 py-2 text-sm text-white placeholder-app-text-muted outline-none resize-none font-mono"
                />
                <p className="text-2xs text-app-text-muted mt-1">{keywordsText.split('\n').filter(Boolean).length} keywords entered</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-app-text-muted mb-1.5">Max Clusters</label>
                <input
                  type="number"
                  value={maxClusters}
                  onChange={(e) => setMaxClusters(Math.max(2, Math.min(20, Number(e.target.value))))}
                  min={2}
                  max={20}
                  className="w-full bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3.5 py-2 text-sm text-white outline-none"
                />
              </div>

              <button
                onClick={handleCluster}
                disabled={loading || keywordsText.split('\n').filter(Boolean).length < 2}
                className="w-full bg-app-signal hover:bg-app-signal/90 disabled:opacity-50 disabled:cursor-not-allowed text-app-base font-semibold text-sm px-4 py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><RefreshCw className="h-4 w-4 animate-spin" /> Clustering...</>
                ) : (
                  <><Layers className="h-4 w-4" /> Cluster Keywords</>
                )}
              </button>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-8 space-y-6">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg">{error}</div>
          )}

          {clusters.length === 0 && !loading ? (
            <EmptyState
              icon={<Layers className="h-6 w-6" />}
              title="Enter keywords to cluster"
              description="Paste your keyword list and we'll group them by search intent and topic."
            />
          ) : loading ? (
            <Card className="p-8 text-center">
              <RefreshCw className="h-8 w-8 animate-spin text-app-signal mx-auto mb-3" />
              <p className="text-sm text-app-text-muted">Analyzing and clustering keywords...</p>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-app-text-muted">
                  {clusters.length} clusters · {totalKeywords} keywords
                </p>
              </div>

              {clusters.map((cluster, i) => (
                <Card key={i} className="overflow-hidden">
                  <button
                    onClick={() => toggleExpanded(i)}
                    className="w-full flex items-center justify-between p-4 hover:bg-app-surface/50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {expanded.has(i) ? (
                        <ChevronDown className="h-4 w-4 text-app-text-muted flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-app-text-muted flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-white truncate">{cluster.name}</h4>
                        <p className="text-xs text-app-text-muted mt-0.5">{cluster.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                      <Badge variant="default">{cluster.keywords.length} keywords</Badge>
                      <span className={`text-2xs font-semibold px-2 py-0.5 rounded-full border ${intentColor(cluster.searchIntent)}`}>
                        {cluster.searchIntent}
                      </span>
                    </div>
                  </button>

                  {expanded.has(i) && (
                    <div className="px-4 pb-4 border-t border-app-border">
                      <div className="mt-3 flex items-center gap-2 mb-3">
                        <span className="text-2xs text-app-text-muted font-semibold">Relevance:</span>
                        <div className="flex-1 h-1.5 bg-app-base rounded-full overflow-hidden max-w-[120px]">
                          <div
                            className="h-full bg-app-signal rounded-full transition-all"
                            style={{ width: `${cluster.relevance}%` }}
                          />
                        </div>
                        <span className="text-2xs text-app-text-muted font-mono">{cluster.relevance}%</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {cluster.keywords.map((kw, j) => (
                          <span
                            key={j}
                            className="text-2xs px-2 py-1 rounded-md bg-app-base border border-app-border text-app-text-muted"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              ))}

              {unassigned.length > 0 && (
                <Card className="p-4">
                  <h4 className="text-sm font-bold text-amber-400 mb-2">Unassigned Keywords ({unassigned.length})</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {unassigned.map((kw, i) => (
                      <span key={i} className="text-2xs px-2 py-1 rounded-md bg-app-base border border-app-border text-app-text-muted">
                        {kw}
                      </span>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
