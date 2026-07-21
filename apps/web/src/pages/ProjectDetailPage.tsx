import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { SearchCheck } from 'lucide-react';
import api from '../lib/api';
import { Card, CardBody, Badge, Button, ScoreReveal, EmptyState } from '../components/ui';

// ─────────────────────────────────────── TYPES ──────────────────────────────

interface Project {
  _id: string;
  name: string;
  domain: string;
  stagingDomain?: string;
  auditSchedule: 'manual' | 'daily' | 'weekly';
  createdAt: string;
}

interface CrawlJob {
  _id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  pageCount: number;
  createdAt: string;
  completedAt?: string;
  healthScore?: number;
}

interface AuditIssue {
  _id: string;
  title: string;
  category: string;
  severity: 'critical' | 'warning' | 'passed';
  affectedUrls: string[];
  recommendation: string;
  whyItMatters?: string;
}

interface Checklist {
  critical: AuditIssue[];
  warning: AuditIssue[];
  passed: AuditIssue[];
}

interface ChecklistResponse {
  checklist: Checklist;
  schema: AuditIssue[];
}

// ──────────────────────────────────────── HELPERS ───────────────────────────

const SEV_CONFIG = {
  critical: {
    label: 'Critical',
    dotColor: 'bg-rose-500',
    badgeBg: 'bg-rose-950/60',
    badgeBorder: 'border-rose-800/40',
    badgeText: 'text-rose-300',
    countColor: 'text-rose-400',
    headerBg: 'bg-rose-950/20',
    headerBorder: 'border-rose-800/30',
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
  },
  warning: {
    label: 'Warning',
    dotColor: 'bg-amber-400',
    badgeBg: 'bg-amber-950/60',
    badgeBorder: 'border-amber-800/40',
    badgeText: 'text-amber-300',
    countColor: 'text-amber-400',
    headerBg: 'bg-amber-950/20',
    headerBorder: 'border-amber-800/30',
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  passed: {
    label: 'Passed',
    dotColor: 'bg-emerald-500',
    badgeBg: 'bg-emerald-950/60',
    badgeBorder: 'border-emerald-800/40',
    badgeText: 'text-emerald-300',
    countColor: 'text-emerald-400',
    headerBg: 'bg-emerald-950/20',
    headerBorder: 'border-emerald-800/30',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
} as const;

// ──────────────────────────────────── SUB-COMPONENTS ────────────────────────

/** Single collapsible checklist section (Critical / Warning / Passed / Schema) */
function ChecklistSection({
  severity,
  items,
  tag,
}: {
  severity: keyof typeof SEV_CONFIG;
  items: AuditIssue[];
  tag?: string; // e.g. "Migration"
}) {
  const [open, setOpen] = useState(severity === 'critical');
  const cfg = SEV_CONFIG[severity];

  return (
    <div className={`border ${cfg.headerBorder} rounded-xl overflow-hidden`}>
      {/* Section header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between px-5 py-3.5 ${cfg.headerBg} hover:brightness-110 transition-all`}
      >
        <div className="flex items-center gap-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 ${cfg.countColor}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d={cfg.icon} />
          </svg>
          <span className="text-sm font-semibold text-white">
            {cfg.label}
            {tag && (
              <Badge variant="default" className="ml-2">{tag}</Badge>
            )}
          </span>
          <span className={`text-sm font-bold ${cfg.countColor}`}>{items.length}</span>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 text-app-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Items */}
      {open && (
        <div className="divide-y divide-slate-800/50">
          {items.length === 0 ? (
            <p className="px-5 py-4 text-xs text-app-text-muted">No issues in this category.</p>
          ) : (
            items.map((issue) => (
              <div key={issue._id} className="px-5 py-4">
                <div className="flex items-start gap-3">
                  <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${cfg.dotColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-sm font-medium text-white">{issue.title}</p>
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${cfg.badgeBg} ${cfg.badgeBorder} ${cfg.badgeText}`}
                      >
                        {issue.category}
                      </span>
                    </div>
                    <p className="text-xs text-app-text leading-relaxed mb-2">
                      {issue.whyItMatters || issue.recommendation}
                    </p>
                    {issue.recommendation && issue.recommendation !== 'No action needed' && (
                      <details className="group mb-1.5">
          <summary className="text-[11px] text-app-signal hover:text-app-signal/80 cursor-pointer select-none">
                            Technical details
                        </summary>
                        <p className="mt-1.5 text-[11px] text-app-text-muted leading-relaxed pl-2">
                          {issue.recommendation}
                        </p>
                      </details>
                    )}
                    {issue.affectedUrls && issue.affectedUrls.length > 0 && (
                      <details className="group">
                        <summary className="text-[11px] text-app-signal hover:text-indigo-300 cursor-pointer select-none">
                          {issue.affectedUrls.length} affected URL
                          {issue.affectedUrls.length !== 1 ? 's' : ''}
                        </summary>
                        <ul className="mt-1.5 space-y-0.5 pl-2">
                          {issue.affectedUrls.slice(0, 10).map((url, i) => (
                            <li key={i} className="text-[11px] text-app-text-muted truncate font-mono">
                              {url}
                            </li>
                          ))}
                          {issue.affectedUrls.length > 10 && (
                            <li className="text-[11px] text-app-text-muted">
                              …and {issue.affectedUrls.length - 10} more
                            </li>
                          )}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Large color-coded SEO Health Score gauge */
const SCORE_CONFIG = {
  red: { stroke: '#f43f5e', bg: 'bg-rose-500/10', border: 'border-rose-500/20', text: 'text-rose-400' },
  yellow: { stroke: '#fbbf24', bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400' },
  green: { stroke: '#34d399', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400' },
};

function getScoreConfig(score: number) {
  if (score < 50) return SCORE_CONFIG.red;
  if (score < 80) return SCORE_CONFIG.yellow;
  return SCORE_CONFIG.green;
}

function HealthScoreGauge({ score, previous }: { score: number; previous: number | null }) {
  const cfg = getScoreConfig(score);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const delta = previous !== null ? score - previous : null;

  return (
    <div className={`flex items-center gap-6 ${cfg.bg} border ${cfg.border} rounded-2xl px-6 py-5`}>
      {/* Circular gauge */}
      <div className="relative w-28 h-28 flex-shrink-0">
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
            className={`transition-all duration-700 ease-out ${cfg.text}`}
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
          <span className="text-3xl font-extrabold text-white">{score}</span>
          <span className="text-[10px] text-app-text-muted uppercase font-semibold -mt-0.5">Health</span>
        </div>
      </div>

      {/* Score info */}
      <div className="flex-1 min-w-0">
        <p className="text-base font-bold text-white">SEO Health Score</p>
        <p className={`text-xs mt-1 ${cfg.text}`}>
          {score >= 80 && 'Looking good! Minor improvements recommended.'}
          {score >= 50 && score < 80 && 'Some issues found — review the warnings below.'}
          {score < 50 && 'Critical issues detected — address these soon.'}
        </p>
        {delta !== null && (
          <p className={`text-xs mt-1.5 font-medium flex items-center gap-1 ${delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {delta >= 0 ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            )}
            {delta > 0 ? '+' : ''}{delta} since last audit
          </p>
        )}
      </div>
    </div>
  );
}

/** Crawl progress bar while status is queued/running */
function CrawlProgressBar({ job }: { job: CrawlJob }) {
  const isRunning = job.status === 'running' || job.status === 'queued';
  const pct = job.status === 'completed' ? 100 : Math.min((job.pageCount / 50) * 100, 95);

  return (
    <Card className="rounded-xl">
      <CardBody className="p-4 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            {isRunning && (
              <span className="h-2 w-2 rounded-full bg-app-signal animate-pulse" />
            )}
            <span className="font-medium text-app-text">
              {job.status === 'queued' && 'Audit queued…'}
              {job.status === 'running' && `Crawling — ${job.pageCount} pages scanned`}
              {job.status === 'completed' && `Completed — ${job.pageCount} pages scanned`}
              {job.status === 'failed' && 'Audit failed'}
            </span>
          </div>
          <span className="text-app-text-muted font-mono">{Math.round(pct)}%</span>
        </div>
        <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              job.status === 'failed'
                ? 'bg-rose-500'
                : job.status === 'completed'
                ? 'bg-emerald-500'
                : 'bg-app-signal'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </CardBody>
    </Card>
  );
}

/** Summary pills shown after audit completes */
function AuditSummaryBar({
  critical,
  warning,
  passed,
  pageCount,
}: {
  critical: number;
  warning: number;
  passed: number;
  pageCount: number;
}) {
  const pills = [
    { label: 'Pages', value: pageCount, color: 'text-app-text', bg: 'bg-slate-800' },
    { label: 'Critical', value: critical, color: 'text-rose-300', bg: 'bg-rose-950/60 border border-rose-800/40' },
    { label: 'Warnings', value: warning, color: 'text-amber-300', bg: 'bg-amber-950/60 border border-amber-800/40' },
    { label: 'Passed', value: passed, color: 'text-emerald-300', bg: 'bg-emerald-950/60 border border-emerald-800/40' },
  ];
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {pills.map((p) => (
        <div key={p.label} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${p.bg} ${p.color}`}>
          <span className="font-bold text-sm">{p.value}</span>
          <span className="text-app-text-muted">{p.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────── MAIN PAGE ───────────────────────────────

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [project, setProject] = useState<Project | null>(null);
  const [projectLoading, setProjectLoading] = useState(true);

  // Audit schedule state
  const [scheduleUpdating, setScheduleUpdating] = useState(false);

  const handleScheduleChange = async (auditSchedule: 'manual' | 'daily' | 'weekly') => {
    if (!id) return;
    setScheduleUpdating(true);
    try {
      const { data } = await api.patch<Project>(`/projects/${id}/schedule`, { auditSchedule });
      setProject(data);
    } catch {
      // silently ignore
    } finally {
      setScheduleUpdating(false);
    }
  };

  // Staging domain editing state
  const [stagingEditing, setStagingEditing] = useState(false);
  const [stagingInput, setStagingInput] = useState('');
  const [migrationAutoJobId, setMigrationAutoJobId] = useState<string | null>(null);

  const handleSaveStagingDomain = async () => {
    if (!id || !project) return;
    try {
      const { data } = await api.patch<any>(`/projects/${id}`, { stagingDomain: stagingInput || undefined });
      setProject(data);
      setStagingEditing(false);
      if (data._migrationCheckJobId) {
        setMigrationAutoJobId(data._migrationCheckJobId);
        const { data: jobData } = await api.get<{ crawlJob: CrawlJob }>(`/crawl-jobs/${data._migrationCheckJobId}`);
        setMigrationJob(jobData.crawlJob);
        startMigrationPolling(data._migrationCheckJobId);
      }
    } catch {
      // silently ignore
    }
  };

  // Health score state
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [previousHealthScore, setPreviousHealthScore] = useState<number | null>(null);

  // Audit state
  const [activeJob, setActiveJob] = useState<CrawlJob | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [checklistData, setChecklistData] = useState<ChecklistResponse | null>(null);
  const [checklistLoading, setChecklistLoading] = useState(false);

  // Migration state
  const [migrationLoading, setMigrationLoading] = useState(false);
  const [migrationJob, setMigrationJob] = useState<CrawlJob | null>(null);
  const [migrationChecklist, setMigrationChecklist] = useState<ChecklistResponse | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const migPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load project ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    api.get<Project>(`/projects/${id}`)
      .then(({ data }) => setProject(data))
      .catch(() => {})
      .finally(() => setProjectLoading(false));
  }, [id]);

  // ── Checklist fetcher ──────────────────────────────────────────────────
  const fetchChecklist = useCallback(async (jobId: string) => {
    setChecklistLoading(true);
    try {
      const { data } = await api.get<ChecklistResponse>(`/crawl-jobs/${jobId}/checklist`);
      setChecklistData(data);
    } catch {
      // silently ignore
    } finally {
      setChecklistLoading(false);
    }
  }, []);

  // ── Poll crawl job status every 3s ────────────────────────────────────
  const startPolling = useCallback(
    (jobId: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await api.get<{ crawlJob: CrawlJob; previousHealthScore?: number | null }>(`/crawl-jobs/${jobId}`);
          setActiveJob(data.crawlJob);
          if (data.crawlJob.status === 'completed' || data.crawlJob.status === 'failed') {
            clearInterval(pollRef.current!);
            pollRef.current = null;
            if (data.crawlJob.status === 'completed') {
              setHealthScore(data.crawlJob.healthScore ?? null);
              setPreviousHealthScore(data.previousHealthScore ?? null);
              fetchChecklist(jobId);
            }
          }
        } catch {
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      }, 3000);
    },
    [fetchChecklist]
  );

  // ── Poll migration job ────────────────────────────────────────────────
  const startMigrationPolling = useCallback((jobId: string) => {
    if (migPollRef.current) clearInterval(migPollRef.current);
    migPollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get<{ crawlJob: CrawlJob }>(`/crawl-jobs/${jobId}`);
        setMigrationJob(data.crawlJob);
        if (data.crawlJob.status === 'completed' || data.crawlJob.status === 'failed') {
          clearInterval(migPollRef.current!);
          migPollRef.current = null;
          if (data.crawlJob.status === 'completed') {
            const { data: cl } = await api.get<ChecklistResponse>(`/crawl-jobs/${jobId}/checklist`);
            setMigrationChecklist(cl);
          }
        }
      } catch {
        clearInterval(migPollRef.current!);
        migPollRef.current = null;
      }
    }, 3000);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (migPollRef.current) clearInterval(migPollRef.current);
    };
  }, []);

  // ── Run Audit ─────────────────────────────────────────────────────────
  const handleRunAudit = async () => {
    if (!id) return;
    setAuditLoading(true);
    setChecklistData(null);
    setActiveJob(null);
    try {
      const { data } = await api.post<{ crawlJobId: string }>(`/projects/${id}/crawl`);
      const { data: jobData } = await api.get<{ crawlJob: CrawlJob }>(`/crawl-jobs/${data.crawlJobId}`);
      setActiveJob(jobData.crawlJob);
      startPolling(data.crawlJobId);
    } catch {
      // show nothing on error
    } finally {
      setAuditLoading(false);
    }
  };

  // ── Run Migration Check ───────────────────────────────────────────────
  const handleMigrationCheck = async () => {
    if (!id) return;
    setMigrationLoading(true);
    setMigrationChecklist(null);
    setMigrationJob(null);
    try {
      const { data } = await api.post<{ crawlJobId: string }>(`/projects/${id}/migration-check`);
      const { data: jobData } = await api.get<{ crawlJob: CrawlJob }>(`/crawl-jobs/${data.crawlJobId}`);
      setMigrationJob(jobData.crawlJob);
      startMigrationPolling(data.crawlJobId);
    } catch {
      // ignore
    } finally {
      setMigrationLoading(false);
    }
  };

  // ── Project loading ───────────────────────────────────────────────────
  if (projectLoading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-4 animate-pulse">
        <div className="h-6 w-48 bg-slate-800 rounded" />
        <div className="h-4 w-32 bg-slate-800 rounded" />
        <div className="h-32 bg-slate-900 border border-slate-800 rounded-2xl mt-6" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8 text-app-text-muted text-sm">
        Project not found.
      </div>
    );
  }

  const allCritical = [
    ...(checklistData?.checklist.critical ?? []),
  ];
  const allWarning = [
    ...(checklistData?.checklist.warning ?? []),
  ];
  const allPassed = [
    ...(checklistData?.checklist.passed ?? []),
  ];
  const schemaIssues = checklistData?.schema ?? [];
  const totalPages = activeJob?.pageCount ?? 0;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">

      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 text-xs text-app-text-muted">
        <Link to="/dashboard" className="hover:text-app-text transition-colors">
          Projects
        </Link>
        <span>/</span>
        <span className="text-app-text">{project.name}</span>
      </div>

      {/* ── Auto Migration Banner ── */}
      {migrationAutoJobId && (
        <div className="flex items-center gap-3 bg-emerald-950/40 border border-emerald-800/30 text-emerald-300 px-4 py-3 rounded-xl">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <div className="flex-1 text-sm">
            Migration check started automatically for{' '}
            <span className="font-semibold">{project.domain}</span> →{' '}
            <span className="font-semibold">{project.stagingDomain}</span>
            {migrationJob?.status === 'running' || migrationJob?.status === 'queued' ? (
              <span className="ml-2 text-emerald-400 animate-pulse">Scanning…</span>
            ) : migrationJob?.status === 'completed' ? (
              <span className="ml-2 text-emerald-400">Complete</span>
            ) : null}
          </div>
          <button
            onClick={() => setMigrationAutoJobId(null)}
            className="text-emerald-500/60 hover:text-emerald-300 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Project Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-white">{project.name}</h1>
          <p className="text-app-text-muted text-sm mt-1 font-mono">{project.domain}</p>
          {stagingEditing ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={stagingInput}
                onChange={(e) => setStagingInput(e.target.value)}
                className="text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-app-text outline-none focus:border-app-signal transition-colors w-64"
                placeholder="https://staging.example.com"
              />
              <Button
                onClick={handleSaveStagingDomain}
                variant="primary"
                className="text-[11px] px-2.5 py-1 rounded-lg font-medium shadow-none"
              >
                Save
              </Button>
              <button
                onClick={() => setStagingEditing(false)}
                className="text-[11px] text-app-text-muted hover:text-app-text px-2 py-1 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : project.stagingDomain ? (
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="warning" className="text-[11px] px-2.5 py-1">
                Staging: {project.stagingDomain}
              </Badge>
              <button
                onClick={() => { setStagingInput(project.stagingDomain!); setStagingEditing(true); }}
                className="text-[10px] text-app-text-muted hover:text-app-text underline transition-colors"
              >
                Edit
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setStagingInput(''); setStagingEditing(true); }}
              className="mt-2 text-[11px] text-app-signal hover:text-indigo-300 font-medium transition-colors"
            >
              + Add staging domain
            </button>
          )}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] text-app-text-muted font-medium">Auto-audit:</span>
            <select
              value={project.auditSchedule}
              onChange={(e) => handleScheduleChange(e.target.value as 'manual' | 'daily' | 'weekly')}
              disabled={scheduleUpdating}
              className="text-[11px] bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-app-text outline-none focus:border-app-signal transition-colors disabled:opacity-50"
            >
              <option value="manual">Off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {project.stagingDomain && (
            <button
              id="migration-check-btn"
              onClick={handleMigrationCheck}
              disabled={migrationLoading || migrationJob?.status === 'running' || migrationJob?.status === 'queued'}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-amber-700/50 bg-amber-950/30 text-amber-300 hover:bg-amber-900/40 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-all"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              {migrationLoading ? 'Starting…' : 'Check Migration Safety'}
            </button>
          )}
          <Button
            id="run-audit-btn"
            onClick={handleRunAudit}
            disabled={
              auditLoading ||
              activeJob?.status === 'running' ||
              activeJob?.status === 'queued'
            }
            className="rounded-xl py-2.5 shadow-lg shadow-app-signal/25"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {auditLoading ? 'Starting…' : 'Run Audit'}
          </Button>
        </div>
      </div>

      {/* ── Feature Navigation Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          {
            label: 'Content Editor',
            desc: 'Write and grade content with AI-powered real-time scoring.',
            to: `/projects/${id}/content-editor`,
            icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
            grad: 'from-app-signal/20 to-app-signal/5',
            border: 'border-app-signal/20',
            iconColor: 'text-app-signal',
          },
          {
            label: 'Keyword Tracking',
            desc: 'Monitor daily rankings and competitor position movements.',
            to: `/projects/${id}/keywords`,
            icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z',
            grad: 'from-emerald-700/30 to-teal-700/30',
            border: 'border-emerald-700/20',
            iconColor: 'text-emerald-300',
          },
        ].map((f) => (
          <Link key={f.label} to={f.to} className="group block">
            <Card className="hover:border-slate-700 hover:shadow-lg hover:-translate-y-0.5 transition-all">
              <CardBody>
                <div className={`h-10 w-10 rounded-xl bg-gradient-to-tr ${f.grad} border ${f.border} flex items-center justify-center mb-3`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${f.iconColor}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={f.icon} />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-white group-hover:text-app-signal transition-colors mb-1">{f.label}</h3>
                <p className="text-xs text-app-text-muted leading-relaxed">{f.desc}</p>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      {/* ─────────────────── AUDIT SECTION ─────────────────── */}
      <div>
        <h2 className="text-base font-bold font-display text-white mb-4 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-app-signal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          SEO Audit
        </h2>

        {/* Health Score Gauge — shown prominently above everything else */}
        {healthScore !== null && (
          <div className="mb-4">
            <ScoreReveal score={healthScore}>
              <HealthScoreGauge score={healthScore} previous={previousHealthScore} />
            </ScoreReveal>
          </div>
        )}

        {/* Live progress bar */}
        {activeJob && (activeJob.status === 'running' || activeJob.status === 'queued') && (
          <div className="mb-4">
            <CrawlProgressBar job={activeJob} />
          </div>
        )}

        {/* Checklist loading skeleton */}
        {checklistLoading && (
          <div className="space-y-3 animate-pulse">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-900 border border-slate-800 rounded-xl" />
            ))}
          </div>
        )}

        {/* Completed — show summary + checklist */}
        {checklistData && !checklistLoading && (
          <div className="space-y-3">
            {/* Completed progress bar */}
            {activeJob && activeJob.status === 'completed' && (
              <CrawlProgressBar job={activeJob} />
            )}

            {/* Summary pills */}
            <AuditSummaryBar
              pageCount={totalPages}
              critical={allCritical.length}
              warning={allWarning.length}
              passed={allPassed.length}
            />

            {/* Checklist sections */}
            <ChecklistSection severity="critical" items={allCritical} />
            <ChecklistSection severity="warning" items={allWarning} />
            <ChecklistSection severity="passed" items={allPassed} />

            {/* Schema section */}
            {schemaIssues.length > 0 && (
              <div className="border border-violet-800/30 rounded-xl overflow-hidden">
                <button
                  onClick={() => {}}
                  className="w-full flex items-center justify-between px-5 py-3.5 bg-violet-950/20 hover:brightness-110 transition-all"
                  id="schema-section-toggle"
                >
                  <div className="flex items-center gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                    <span className="text-sm font-semibold text-white">JSON-LD Schema</span>
                    <span className="text-sm font-bold text-violet-400">{schemaIssues.length}</span>
                  </div>
                </button>
                <div className="divide-y divide-slate-800/50">
                  {schemaIssues.map((issue) => {
                    const sev = issue.severity as keyof typeof SEV_CONFIG;
                    const cfg = SEV_CONFIG[sev] ?? SEV_CONFIG.warning;
                    return (
                      <div key={issue._id} className="px-5 py-4">
                        <div className="flex items-start gap-3">
                          <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${cfg.dotColor}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <p className="text-sm font-medium text-white">{issue.title}</p>
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${cfg.badgeBg} ${cfg.badgeBorder} ${cfg.badgeText}`}>
                                schema · {sev}
                              </span>
                            </div>
                            <p className="text-xs text-app-text-muted leading-relaxed">{issue.recommendation}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state — no audit yet */}
        {!activeJob && !checklistData && !checklistLoading && !auditLoading && (
          <EmptyState
            icon={<SearchCheck className="h-7 w-7" />}
            title="No audits run yet"
            description="An audit checks your pages for technical SEO issues that affect AI Overview visibility — from missing meta tags and slow load times to redirect chains and broken schema markup."
          />
        )}
      </div>

      {/* ─────────────────── MIGRATION SECTION ─────────────────── */}
      {project.stagingDomain && (migrationJob || migrationChecklist) && (
        <div>
          <h2 className="text-base font-bold font-display text-white mb-4 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Migration Safety Check
            <span className="text-[11px] text-app-text-muted font-normal">
              {project.domain} → {project.stagingDomain}
            </span>
          </h2>

          {/* Migration progress */}
          {migrationJob && (migrationJob.status === 'running' || migrationJob.status === 'queued') && (
            <div className="mb-4">
              <CrawlProgressBar job={migrationJob} />
            </div>
          )}

          {/* Migration checklist — redirect issues tagged "Migration" */}
          {migrationChecklist && (
            <div className="space-y-3">
              {migrationJob && migrationJob.status === 'completed' && (
                <CrawlProgressBar job={migrationJob} />
              )}
              <ChecklistSection
                severity="critical"
                items={migrationChecklist.checklist.critical}
                tag="Migration"
              />
              <ChecklistSection
                severity="warning"
                items={migrationChecklist.checklist.warning}
                tag="Migration"
              />
              <ChecklistSection
                severity="passed"
                items={migrationChecklist.checklist.passed}
                tag="Migration"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
