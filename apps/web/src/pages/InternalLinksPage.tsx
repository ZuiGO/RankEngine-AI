import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Link2, RefreshCw, Plus, Trash2 } from 'lucide-react';
import api from '../lib/api';
import { Card, Badge, EmptyState } from '../components/ui';

interface PageInput {
  url: string;
  title: string;
  headings: string;
  contentSnippet: string;
}

interface Suggestion {
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

export default function InternalLinksPage() {
  const { id } = useParams<{ id: string }>();
  const [pages, setPages] = useState<PageInput[]>([
    { url: '', title: '', headings: '', contentSnippet: '' },
    { url: '', title: '', headings: '', contentSnippet: '' },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const updatePage = (i: number, field: keyof PageInput, value: string) => {
    setPages((prev) => prev.map((p, idx) => idx === i ? { ...p, [field]: value } : p));
  };

  const addPage = () => {
    setPages((prev) => [...prev, { url: '', title: '', headings: '', contentSnippet: '' }]);
  };

  const removePage = (i: number) => {
    if (pages.length <= 2) return;
    setPages((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleAnalyze = async () => {
    const validPages = pages.filter((p) => p.url.trim());
    if (validPages.length < 2) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post(`/projects/${id}/internal-links`, {
        pages: validPages.map((p) => ({
          url: p.url,
          title: p.title || undefined,
          headings: p.headings ? p.headings.split('\n').map((h) => h.trim()).filter(Boolean) : undefined,
          contentSnippet: p.contentSnippet || undefined,
        })),
        maxSuggestions: 20,
      });
      setSuggestions(data.suggestions || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const priorityBadge = (p: string) => {
    switch (p) {
      case 'high': return <Badge variant="success">High</Badge>;
      case 'medium': return <Badge variant="warning">Medium</Badge>;
      case 'low': return <Badge variant="default">Low</Badge>;
      default: return <Badge>{p}</Badge>;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <Link to={`/projects/${id}`} className="text-xs text-app-signal hover:text-app-signal/80 font-semibold flex items-center space-x-1">
          <span>← Back to Project</span>
        </Link>
        <span className="text-app-text-muted text-xs">Internal Linking Suggestions</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 space-y-6">
          <Card className="p-5">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Link2 className="h-4 w-4 text-app-signal" />
              Page List
            </h3>

            <div className="space-y-4">
              {pages.map((page, i) => (
                <div key={i} className="p-3 bg-app-base border border-app-border rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-2xs font-semibold text-app-text-muted">Page {i + 1}</span>
                    {pages.length > 2 && (
                      <button onClick={() => removePage(i)} className="text-rose-400 hover:text-rose-300">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={page.url}
                    onChange={(e) => updatePage(i, 'url', e.target.value)}
                    placeholder="URL (e.g. /seo-guide)"
                    className="w-full bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-app-text-muted outline-none"
                  />
                  <input
                    type="text"
                    value={page.title}
                    onChange={(e) => updatePage(i, 'title', e.target.value)}
                    placeholder="Page title (optional)"
                    className="w-full bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-app-text-muted outline-none"
                  />
                  <textarea
                    value={page.headings}
                    onChange={(e) => updatePage(i, 'headings', e.target.value)}
                    placeholder="Headings (one per line, optional)"
                    rows={2}
                    className="w-full bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-app-text-muted outline-none resize-none"
                  />
                  <textarea
                    value={page.contentSnippet}
                    onChange={(e) => updatePage(i, 'contentSnippet', e.target.value)}
                    placeholder="Content snippet (optional)"
                    rows={2}
                    className="w-full bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-app-text-muted outline-none resize-none"
                  />
                </div>
              ))}

              <button
                onClick={addPage}
                className="w-full text-xs text-app-signal hover:text-app-signal/80 font-semibold flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed border-app-border hover:border-app-signal/30 transition-all"
              >
                <Plus className="h-3 w-3" /> Add Page
              </button>

              <button
                onClick={handleAnalyze}
                disabled={loading || pages.filter((p) => p.url.trim()).length < 2}
                className="w-full bg-app-signal hover:bg-app-signal/90 disabled:opacity-50 disabled:cursor-not-allowed text-app-base font-semibold text-sm px-4 py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><RefreshCw className="h-4 w-4 animate-spin" /> Analyzing...</>
                ) : (
                  <><Link2 className="h-4 w-4" /> Find Link Opportunities</>
                )}
              </button>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-7 space-y-6">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg">{error}</div>
          )}

          {suggestions.length === 0 && !loading ? (
            <EmptyState
              icon={<Link2 className="h-6 w-6" />}
              title="Add pages to find link opportunities"
              description="Enter at least 2 page URLs to discover internal linking suggestions."
            />
          ) : loading ? (
            <Card className="p-8 text-center">
              <RefreshCw className="h-8 w-8 animate-spin text-app-signal mx-auto mb-3" />
              <p className="text-sm text-app-text-muted">Analyzing page relationships...</p>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-app-text-muted">{suggestions.length} suggestions found</p>
              </div>

              {suggestions.map((s, i) => (
                <Card key={i} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-2xs font-mono text-app-text-muted truncate">{s.sourceUrl}</span>
                        <span className="text-app-text-muted text-xs">→</span>
                        <span className="text-2xs font-mono text-app-signal truncate">{s.targetUrl}</span>
                      </div>
                      <p className="text-xs text-white font-semibold mt-1">
                        Anchor: <span className="text-app-signal">&ldquo;{s.anchorText}&rdquo;</span>
                      </p>
                      <p className="text-2xs text-app-text-muted mt-1">{s.reason}</p>
                    </div>
                    <div className="flex-shrink-0">{priorityBadge(s.priority)}</div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
