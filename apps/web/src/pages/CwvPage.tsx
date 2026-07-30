import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Activity, RefreshCw, Globe, Search } from 'lucide-react';
import api from '../lib/api';
import { Card, Badge, StatGauge, EmptyState } from '../components/ui';

interface Metric {
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
}

interface IndexingStatus {
  accessible: boolean;
  robotsBlocked: boolean;
  hasSitemap: boolean;
  metaRobots: string | null;
}

export default function CwvPage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<{
    url: string;
    overallScore: number;
    metrics: { lcp: Metric; inp: Metric; cls: Metric; fcp: Metric; ttfb: Metric };
    recommendations: string[];
    indexingStatus: IndexingStatus;
    source: string;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: result } = await api.get(`/projects/${id}/cwv`);
      setData(result);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load Core Web Vitals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const ratingBadge = (r: string) => {
    switch (r) {
      case 'good': return <Badge variant="success">Good</Badge>;
      case 'needs-improvement': return <Badge variant="warning">Needs Improvement</Badge>;
      case 'poor': return <Badge variant="danger">Poor</Badge>;
      default: return <Badge>{r}</Badge>;
    }
  };

  const formatMs = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
  const formatCls = (v: number) => v.toFixed(3);

  const metricCard = (label: string, metric: Metric, formatter: (v: number) => string, desc: string) => (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-app-text">{label}</span>
        {ratingBadge(metric.rating)}
      </div>
      <p className="text-2xl font-extrabold text-white mb-1">{formatter(metric.value)}</p>
      <p className="text-2xs text-app-text-muted">{desc}</p>
    </Card>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <Link to={`/projects/${id}`} className="text-xs text-app-signal hover:text-app-signal/80 font-semibold flex items-center space-x-1">
          <span>← Back to Project</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-app-text-muted text-xs">Core Web Vitals & Indexing</span>
          <button
            onClick={load}
            disabled={loading}
            className="text-xs text-app-signal hover:text-app-signal/80 font-semibold flex items-center gap-1 px-3 py-1.5 rounded-lg border border-app-signal/30 hover:bg-app-signal/10 transition-all"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-6">{error}</div>
      )}

      {loading && !data ? (
        <Card className="p-8 text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-app-signal mx-auto mb-3" />
          <p className="text-sm text-app-text-muted">Analyzing Core Web Vitals...</p>
        </Card>
      ) : !data ? (
        <EmptyState
          icon={<Activity className="h-6 w-6" />}
          title="No data available"
          description="Could not fetch Core Web Vitals. Check that the domain is valid."
        />
      ) : (
        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-app-signal flex-shrink-0" />
                <a
                  href={data.url.startsWith('http') ? data.url : `https://${data.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-bold text-app-signal hover:underline truncate"
                >
                  {data.url}
                </a>
              </div>
              <Badge variant={data.source === 'pagespeed-api' ? 'success' : data.source === 'live-probe' ? 'info' : 'warning'}>
                {data.source === 'pagespeed-api' ? 'PageSpeed API' : data.source === 'live-probe' ? 'Live Network Probe' : 'Crawl Audit Data'}
              </Badge>
            </div>

            <StatGauge score={data.overallScore} size={140} label="Performance">
              <p className="text-sm font-bold text-white">Overall Score</p>
              <p className="text-xs text-app-text-muted">
                {data.overallScore >= 90 ? 'Excellent performance' :
                 data.overallScore >= 70 ? 'Good, but can improve' :
                 data.overallScore >= 50 ? 'Needs improvement' :
                 'Poor performance'}
              </p>
            </StatGauge>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {metricCard('LCP (Largest Contentful Paint)', data.metrics.lcp, formatMs, 'Loading performance — target < 2.5s')}
            {metricCard('INP (Interaction to Next Paint)', data.metrics.inp, formatMs, 'Interactivity — target < 200ms')}
            {metricCard('CLS (Cumulative Layout Shift)', data.metrics.cls, formatCls, 'Visual stability — target < 0.1')}
            {metricCard('FCP (First Contentful Paint)', data.metrics.fcp, formatMs, 'First impression — target < 1.8s')}
            {metricCard('TTFB (Time to First Byte)', data.metrics.ttfb, formatMs, 'Server response — target < 800ms')}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="p-5">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-app-signal" />
                Recommendations
              </h3>
              {data.recommendations.length === 0 ? (
                <p className="text-xs text-app-text-muted">No recommendations available. Run a PageSpeed test for detailed suggestions.</p>
              ) : (
                <ul className="space-y-2">
                  {data.recommendations.map((rec, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-app-text-muted">
                      <span className="text-amber-400 mt-0.5">•</span>
                      {rec}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <Search className="h-4 w-4 text-app-signal" />
                Indexing Status
              </h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-app-text-muted">Accessible</span>
                  <Badge variant={data.indexingStatus.accessible ? 'success' : 'danger'}>
                    {data.indexingStatus.accessible ? 'Yes' : 'No'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-app-text-muted">Blocked by robots.txt</span>
                  <Badge variant={data.indexingStatus.robotsBlocked ? 'danger' : 'success'}>
                    {data.indexingStatus.robotsBlocked ? 'Yes' : 'No'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-app-text-muted">Has Sitemap</span>
                  <Badge variant={data.indexingStatus.hasSitemap ? 'success' : 'warning'}>
                    {data.indexingStatus.hasSitemap ? 'Yes' : 'Unknown'}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-app-text-muted">Meta Robots</span>
                  <span className="text-xs font-mono text-app-text">{data.indexingStatus.metaRobots || 'Unknown'}</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
