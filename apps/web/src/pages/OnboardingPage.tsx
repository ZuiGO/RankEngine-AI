import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';

// ── Types ──────────────────────────────────────────────────────────────────

interface Project {
  _id: string;
  name: string;
  domain: string;
  stagingDomain?: string;
}

interface CrawlJob {
  _id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  pageCount: number;
  healthScore: number;
}

// ── Config helpers (same pattern as ProjectDetailPage) ─────────────────────

function getScoreConfig(score: number) {
  if (score >= 80) return { text: 'text-emerald-400', stroke: '#34d399', bg: 'bg-emerald-900/10', border: 'border-emerald-800/30' };
  if (score >= 50) return { text: 'text-amber-400', stroke: '#fbbf24', bg: 'bg-amber-900/10', border: 'border-amber-800/30' };
  return { text: 'text-rose-400', stroke: '#f43f5e', bg: 'bg-rose-900/10', border: 'border-rose-800/30' };
}

// ── Onboarding Page ─────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 state
  const [projectName, setProjectName] = useState('');
  const [domain, setDomain] = useState('');
  const [stagingDomain, setStagingDomain] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [createdProject, setCreatedProject] = useState<Project | null>(null);

  // Step 2 state
  const [crawlJob, setCrawlJob] = useState<CrawlJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 3 state
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Step 1: Create project ──────────────────────────────────────────────

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { data } = await api.post<Project & { _firstCrawlJobId?: string }>('/projects', {
        name: projectName.trim(),
        domain: domain.trim(),
        ...(stagingDomain.trim() ? { stagingDomain: stagingDomain.trim() } : {}),
        triggerFirstAudit: true,
      });
      setCreatedProject(data);

      const jobId = (data as any)._firstCrawlJobId;
      if (jobId) {
        setCrawlJob({ _id: jobId, status: 'queued', pageCount: 0, healthScore: 0 });
        setStep(2);
        startPolling(jobId);
      } else {
        // Fallback — no crawl queued, go straight to results
        setStep(3);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to create project.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 2: Poll audit progress ─────────────────────────────────────────

  const startPolling = (jobId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get<{ crawlJob: CrawlJob }>(`/crawl-jobs/${jobId}`);
        setCrawlJob(data.crawlJob);
        if (data.crawlJob.status === 'completed' || data.crawlJob.status === 'failed') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          if (data.crawlJob.status === 'completed') {
            setHealthScore(data.crawlJob.healthScore ?? null);
          }
          setStep(3);
        }
      } catch {
        clearInterval(pollRef.current!);
        pollRef.current = null;
      }
    }, 3000);
  };

  // ── Step 3: Finish onboarding ───────────────────────────────────────────

  const handleFinish = async () => {
    setFinishing(true);
    try {
      await api.patch('/auth/onboarding-complete');
      await refreshProfile();
      navigate(`/projects/${createdProject!._id}`);
    } catch {
      // If the request fails, navigate anyway
      await refreshProfile();
      navigate(`/projects/${createdProject!._id}`);
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[1, 2, 3].map((s) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              s === step
                ? 'bg-indigo-600 text-white'
                : s < step
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-800 text-slate-500'
            }`}
          >
            {s < step ? '✓' : s}
          </div>
          {s < 3 && <div className={`h-0.5 w-8 ${s < step ? 'bg-emerald-600' : 'bg-slate-800'}`} />}
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-4 py-12">
      {/* Logo */}
      <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 shadow-lg shadow-indigo-500/30 mb-6">
        <span className="text-white font-bold text-lg">RE</span>
      </div>

      {renderStepIndicator()}

      {/* ── Step 1: Add your first site ─────────────────────────────────── */}
      {step === 1 && (
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl shadow-black/40">
          <h2 className="text-lg font-bold text-white mb-1">Add your first site</h2>
          <p className="text-sm text-slate-400 mb-5">
            We'll scan up to 5,000 pages and tell you what's holding back your AI Overview visibility.
          </p>

          {error && (
            <div className="bg-red-950/60 border border-red-800/50 text-red-300 text-sm rounded-lg px-4 py-2.5 mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleCreateProject} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Project name</label>
              <input
                type="text"
                required
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
                placeholder="My Website"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Live domain</label>
              <input
                type="text"
                required
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
                placeholder="example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Staging domain <span className="text-slate-600 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={stagingDomain}
                onChange={(e) => setStagingDomain(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
                placeholder="staging.example.com"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm py-2.5 rounded-lg transition-all shadow-lg shadow-indigo-600/30"
            >
              {submitting ? 'Creating…' : 'Start scanning'}
            </button>
          </form>
        </div>
      )}

      {/* ── Step 2: Audit running ────────────────────────────────────────── */}
      {step === 2 && (
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl shadow-black/40 text-center">
          <div className="flex items-center justify-center mb-6">
            <div className="relative">
              <div className="h-16 w-16 rounded-full border-4 border-slate-800 border-t-indigo-500 animate-spin" />
            </div>
          </div>

          <h2 className="text-lg font-bold text-white mb-1">We're scanning your site</h2>
          <p className="text-sm text-slate-400 mb-6">
            {crawlJob?.status === 'queued'
              ? 'Your audit has been queued and will start shortly.'
              : 'Crawling pages and analyzing issues…'}
          </p>

          {crawlJob && (
            <div className="bg-slate-800/50 rounded-xl px-4 py-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">
                  {crawlJob.status === 'queued' && 'Queued'}
                  {crawlJob.status === 'running' && `Crawling — ${crawlJob.pageCount} pages`}
                </span>
                <span className="text-slate-500 font-mono">
                  {crawlJob.status === 'queued' ? '—' : `${Math.min(Math.round((crawlJob.pageCount / 50) * 100), 95)}%`}
                </span>
              </div>
              <div className="w-full bg-slate-700 h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-700"
                  style={{ width: crawlJob.status === 'queued' ? '5%' : `${Math.min((crawlJob.pageCount / 50) * 100, 95)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Health Score ─────────────────────────────────────────── */}
      {step === 3 && (
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl shadow-black/40">
          {healthScore !== null ? (
            <>
              <div className="text-center mb-6">
                <h2 className="text-lg font-bold text-white mb-1">Your SEO Health Score</h2>
                <p className="text-sm text-slate-400">
                  This measures how well your site is optimized for AI Overview visibility.
                </p>
              </div>

              <div className="flex justify-center mb-6">
                <GaugeCircle score={healthScore} />
              </div>

              <div className={`text-center text-sm font-medium mb-6 ${getScoreConfig(healthScore).text}`}>
                {healthScore >= 80 && 'Looking good! Minor improvements recommended.'}
                {healthScore >= 50 && healthScore < 80 && 'Some issues found — review the warnings below.'}
                {healthScore < 50 && 'Critical issues detected — address these soon.'}
              </div>

              {createdProject && (
                <button
                  onClick={handleFinish}
                  disabled={finishing}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm py-2.5 rounded-lg transition-all shadow-lg shadow-indigo-600/30 mb-3"
                >
                  {finishing ? 'Loading…' : 'Explore full results'}
                </button>
              )}
              <p className="text-xs text-slate-500 text-center">
                You can run new audits and manage settings from the dashboard.
              </p>
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-slate-400">
                {crawlJob?.status === 'failed'
                  ? 'The audit encountered an error. You can retry from the project page.'
                  : 'Audit complete! Loading your results…'}
              </p>
              {createdProject && (
                <button
                  onClick={handleFinish}
                  className="mt-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm py-2.5 px-5 rounded-lg transition-all"
                >
                  Go to project
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Health Score Gauge ─────────────────────────────────────────────────────

function GaugeCircle({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const cfg = getScoreConfig(score);

  return (
    <div className="relative w-36 h-36">
      <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
        <circle
          className="stroke-slate-800"
          strokeWidth="8"
          fill="transparent"
          r={radius}
          cx="60"
          cy="60"
        />
        <circle
          className="transition-all duration-700 ease-out"
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          fill="transparent"
          r={radius}
          cx="60"
          cy="60"
          style={{ stroke: cfg.stroke }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-extrabold text-white">{score}</span>
        <span className="text-xs text-slate-500 uppercase font-semibold -mt-0.5">Health</span>
      </div>
    </div>
  );
}
