import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Sparkles, RefreshCw } from 'lucide-react';
import api from '../lib/api';
import { Card, Badge, EmptyState } from '../components/ui';

type Tone = 'professional' | 'conversational' | 'persuasive' | 'informative';
type Length = 'short' | 'medium' | 'long';

export default function ContentWriterPage() {
  const { id } = useParams<{ id: string }>();
  const [topic, setTopic] = useState('');
  const [keywords, setKeywords] = useState('');
  const [tone, setTone] = useState<Tone>('professional');
  const [length, setLength] = useState<Length>('medium');
  const [outline, setOutline] = useState('');

  const [loading, setLoading] = useState(false);
  const [improving, setImproving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    title: string;
    content: string;
    metaDescription: string;
    keyPoints: string[];
  } | null>(null);

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post(`/projects/${id}/content-writer/generate`, {
        topic,
        keywords: keywords ? keywords.split(',').map((k) => k.trim()).filter(Boolean) : undefined,
        tone,
        length,
        outline: outline || undefined,
      });
      setResult(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleImprove = async () => {
    if (!result?.content) return;
    setImproving(true);
    try {
      const { data } = await api.post(`/projects/${id}/content-writer/improve`, {
        content: result.content,
        instructions: `Improve the tone to be more ${tone} and optimize for SEO`,
      });
      setResult(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Improvement failed');
    } finally {
      setImproving(false);
    }
  };

  const copyContent = () => {
    if (result?.content) {
      navigator.clipboard.writeText(result.content);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <Link to={`/projects/${id}`} className="text-xs text-app-signal hover:text-app-signal/80 font-semibold flex items-center space-x-1">
          <span>← Back to Project</span>
        </Link>
        <span className="text-app-text-muted text-xs">AI Content Writer</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 space-y-6">
          <Card className="p-5">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-app-signal" />
              Generate Content
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-app-text-muted mb-1.5">Topic *</label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. A Complete Guide to On-Page SEO"
                  className="w-full bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3.5 py-2 text-sm text-white placeholder-app-text-muted outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-app-text-muted mb-1.5">Keywords (comma-separated)</label>
                <input
                  type="text"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="seo guide, on-page optimization, meta tags"
                  className="w-full bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3.5 py-2 text-sm text-white placeholder-app-text-muted outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-app-text-muted mb-1.5">Tone</label>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value as Tone)}
                    className="w-full bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3.5 py-2 text-sm text-white outline-none"
                  >
                    <option value="professional">Professional</option>
                    <option value="conversational">Conversational</option>
                    <option value="persuasive">Persuasive</option>
                    <option value="informative">Informative</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-app-text-muted mb-1.5">Length</label>
                  <select
                    value={length}
                    onChange={(e) => setLength(e.target.value as Length)}
                    className="w-full bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3.5 py-2 text-sm text-white outline-none"
                  >
                    <option value="short">Short (~300 words)</option>
                    <option value="medium">Medium (~800 words)</option>
                    <option value="long">Long (~1500 words)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-app-text-muted mb-1.5">Outline (optional, one section per line)</label>
                <textarea
                  value={outline}
                  onChange={(e) => setOutline(e.target.value)}
                  placeholder="Introduction&#10;What is On-Page SEO?&#10;Key Elements&#10;Best Practices&#10;Conclusion"
                  rows={4}
                  className="w-full bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3.5 py-2 text-sm text-white placeholder-app-text-muted outline-none resize-none"
                />
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading || !topic.trim()}
                className="w-full bg-app-signal hover:bg-app-signal/90 disabled:opacity-50 disabled:cursor-not-allowed text-app-base font-semibold text-sm px-4 py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><RefreshCw className="h-4 w-4 animate-spin" /> Generating...</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> Generate Content</>
                )}
              </button>
            </div>
          </Card>

          {result && (
            <Card className="p-5">
              <h3 className="text-sm font-bold text-white mb-3">Key Points</h3>
              <ul className="space-y-2">
                {result.keyPoints.map((point, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-app-text-muted">
                    <span className="text-app-signal mt-0.5">•</span>
                    {point}
                  </li>
                ))}
              </ul>

              <div className="mt-4 p-3 bg-app-base border border-app-border rounded-lg">
                <p className="text-2xs text-app-text-muted font-semibold mb-1">Meta Description</p>
                <p className="text-xs text-app-text">{result.metaDescription}</p>
              </div>
            </Card>
          )}
        </div>

        <div className="lg:col-span-7 space-y-6">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg">{error}</div>
          )}

          {!result && !loading ? (
            <EmptyState
              icon={<Sparkles className="h-6 w-6" />}
              title="Ready to write content"
              description="Enter a topic and generate SEO-optimized content powered by AI."
            />
          ) : (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white">{result?.title || 'Generated Content'}</h3>
                <div className="flex items-center gap-2">
                  {result && (
                    <>
                      <button
                        onClick={copyContent}
                        className="text-xs text-app-signal hover:text-app-signal/80 font-semibold px-3 py-1.5 rounded-lg border border-app-signal/30 hover:bg-app-signal/10 transition-all"
                      >
                        Copy
                      </button>
                      <button
                        onClick={handleImprove}
                        disabled={improving}
                        className="text-xs text-amber-400 hover:text-amber-300 font-semibold px-3 py-1.5 rounded-lg border border-amber-500/30 hover:bg-amber-500/10 transition-all flex items-center gap-1.5"
                      >
                        {improving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Improve
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="prose prose-invert prose-sm max-w-none">
                {result?.content.split('\n').map((line, i) => {
                  if (line.startsWith('# ')) return <h1 key={i} className="text-lg font-bold text-white mt-4 mb-2">{line.replace('# ', '')}</h1>;
                  if (line.startsWith('## ')) return <h2 key={i} className="text-base font-bold text-app-text mt-4 mb-2">{line.replace('## ', '')}</h2>;
                  if (line.startsWith('### ')) return <h3 key={i} className="text-sm font-bold text-app-text mt-3 mb-1">{line.replace('### ', '')}</h3>;
                  if (line.startsWith('- ')) return <li key={i} className="text-xs text-app-text-muted ml-4">{line.replace('- ', '')}</li>;
                  if (line.trim() === '') return <br key={i} />;
                  return <p key={i} className="text-xs text-app-text-muted leading-relaxed mb-2">{line}</p>;
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
