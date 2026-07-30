import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Link2 } from 'lucide-react';
import api from '../lib/api';
import { Card, EmptyState } from '../components/ui';

interface Suggestion {
  sourcePage: string;
  targetPage: string;
  suggestedAnchorText: string;
}

export default function InternalLinksPage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/projects/${id}/internal-links`);
      setSuggestions(data.suggestions || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load internal link suggestions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <Link to={`/projects/${id}`} className="text-xs text-app-signal hover:text-app-signal/80 font-semibold flex items-center space-x-1">
          <span>← Back to Project</span>
        </Link>
        <span className="text-app-text-muted text-xs">Internal Link Suggestions</span>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-6">{error}</div>
      )}

      <p className="text-xs text-app-text-muted mb-4">
        These are suggested internal links based on topic similarity across your site. Add them manually — RankEngine doesn't have access to edit your site directly.
      </p>

      {loading ? (
        <Card className="p-8 text-center">
          <div className="flex items-center justify-center space-x-2">
            <div className="animate-spin h-5 w-5 border-2 border-app-signal border-t-transparent rounded-full" />
            <p className="text-sm text-app-text-muted">Loading suggestions...</p>
          </div>
        </Card>
      ) : suggestions.length === 0 ? (
        <EmptyState
          icon={<Link2 className="h-6 w-6" />}
          title="No internal link suggestions yet"
          description="Suggestions appear after a completed audit. Run a crawl to generate topic-based internal link recommendations."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-app-border">
                <th className="text-left py-3 px-4 font-semibold text-app-text text-2xs uppercase tracking-wider">Source Page</th>
                <th className="text-left py-3 px-4 font-semibold text-app-text text-2xs uppercase tracking-wider">Suggested Target Page</th>
                <th className="text-left py-3 px-4 font-semibold text-app-text text-2xs uppercase tracking-wider">Suggested Anchor Text</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s, i) => (
                <tr key={i} className="border-b border-app-border/50 last:border-b-0 hover:bg-app-base/50">
                  <td className="py-3 px-4 font-mono text-app-text-muted truncate max-w-[300px]">
                    <a
                      href={s.sourcePage.startsWith('http') ? s.sourcePage : `https://${s.sourcePage}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-app-signal hover:underline truncate block"
                    >
                      {s.sourcePage}
                    </a>
                  </td>
                  <td className="py-3 px-4 font-mono text-app-signal truncate max-w-[300px]">
                    <a
                      href={s.targetPage.startsWith('http') ? s.targetPage : `https://${s.targetPage}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline truncate block"
                    >
                      {s.targetPage}
                    </a>
                  </td>
                  <td className="py-3 px-4 text-white">{s.suggestedAnchorText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
