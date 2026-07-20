import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderSearch } from 'lucide-react';
import api from '../lib/api';
import { Card, CardBody, Badge, Button, EmptyState } from '../components/ui';

interface Project {
  _id: string;
  name: string;
  domain: string;
  stagingDomain?: string;
  createdAt: string;
}

interface ProjectSummary {
  backlinks: number | null;
  bestKeywordPosition: number | null;
  keywordCount: number;
  aiVisibility: number | null;
  loading: boolean;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

function NewProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (p: Project) => void;
}) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [stagingDomain, setStagingDomain] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post<Project>('/projects', {
        name: name.trim(),
        domain: domain.trim(),
        ...(stagingDomain.trim() ? { stagingDomain: stagingDomain.trim() } : {}),
      });
      onCreate(data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to create project.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <Card className="w-full max-w-md shadow-2xl shadow-black/60 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">New Project</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="bg-red-950/60 border border-red-800/50 text-red-300 text-sm rounded-lg px-4 py-2.5">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5" htmlFor="project-name">
              Project name <span className="text-red-400">*</span>
            </label>
            <input
              id="project-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
              placeholder="My Website SEO"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5" htmlFor="project-domain">
              Live domain <span className="text-red-400">*</span>
            </label>
            <input
              id="project-domain"
              type="text"
              required
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
              placeholder="example.com"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5" htmlFor="project-staging">
              Staging domain <span className="text-slate-600 font-normal">(optional)</span>
            </label>
            <input
              id="project-staging"
              type="text"
              value={stagingDomain}
              onChange={(e) => setStagingDomain(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-colors"
              placeholder="staging.example.com"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              className="flex-1 py-2.5"
            >
              Cancel
            </Button>
            <Button
              id="create-project-submit-btn"
              type="submit"
              loading={loading}
              className="flex-1 py-2.5 disabled:opacity-60 shadow-indigo-600/30"
            >
              {loading ? 'Creating…' : 'Create project'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function fetchProjectSummary(id: string): Promise<ProjectSummary> {
  return Promise.all([
    api
      .get<{ totalBacklinks: number }>(`/projects/${id}/backlinks/overview`)
      .then((r) => r.data.totalBacklinks)
      .catch(() => null),
    api
      .get<any[]>(`/projects/${id}/keywords`)
      .then((r) => {
        const list = Array.isArray(r.data) ? r.data : [];
        const positions = list
          .map((k: any) => k.currentPosition)
          .filter((p: number) => p != null && p < 101);
        return {
          best: positions.length > 0 ? Math.min(...positions) : null,
          count: list.length,
        };
      })
      .catch(() => ({ best: null, count: 0 })),
    api
      .get<{ visibilityScore: number }>(`/projects/${id}/ai-visibility`)
      .then((r) => r.data.visibilityScore)
      .catch(() => null),
  ]).then(([backlinks, kw, aiVis]) => ({
    backlinks,
    bestKeywordPosition: kw.best,
    keywordCount: kw.count,
    aiVisibility: aiVis,
    loading: false,
  }));
}

function HealthBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-slate-600 text-2xs">—</span>;
  let color: string;
  if (score >= 70) color = 'text-emerald-400';
  else if (score >= 40) color = 'text-amber-400';
  else color = 'text-rose-400';
  return <span className={`text-xs font-bold tabular-nums ${color}`}>{score}</span>;
}

function ProjectCard({
  project,
  summary,
  onClick,
}: {
  project: Project;
  summary: ProjectSummary | null;
  onClick: () => void;
}) {
  const formatNumber = (n: number | null) =>
    n != null ? n.toLocaleString() : '…';

  return (
    <Card
      className="group hover:border-indigo-700/50 cursor-pointer transition-all hover:shadow-xl hover:shadow-indigo-950/30 hover:-translate-y-0.5"
      onClick={onClick}
    >
      <CardBody>
      {/* Top row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-700/40 to-violet-700/40 border border-indigo-700/20 flex items-center justify-center text-indigo-300 font-bold text-sm flex-shrink-0">
            {project.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white group-hover:text-indigo-200 transition-colors truncate">
              {project.name}
            </h3>
            <p className="text-xs text-slate-500 truncate">{project.domain}</p>
          </div>
        </div>
        {project.stagingDomain && (
          <Badge variant="warning" className="flex-shrink-0 ml-2">Staging</Badge>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-4 gap-3 mb-3 py-2.5 px-3 bg-slate-950/60 rounded-xl border border-slate-800/50">
        <div className="text-center">
          <p className="text-2xs text-slate-600 uppercase font-semibold tracking-wider mb-0.5">Health</p>
          <HealthBadge
            score={
              summary && !summary.loading
                ? Math.round(
                    ((summary.aiVisibility ?? 0) +
                      (summary.backlinks ? Math.min(summary.backlinks / 100, 100) : 0) +
                      (summary.bestKeywordPosition
                        ? Math.max(0, 100 - summary.bestKeywordPosition * 2)
                        : summary.keywordCount > 0 ? 50 : 0)) / 3
                  )
                : null
            }
          />
        </div>
        <div className="text-center">
          <p className="text-2xs text-slate-600 uppercase font-semibold tracking-wider mb-0.5">Rank</p>
          <p className="text-xs font-bold text-white tabular-nums">
            {summary && !summary.loading
              ? summary.bestKeywordPosition != null
                ? `#${summary.bestKeywordPosition}`
                : summary.keywordCount > 0
                  ? '101+'
                  : '—'
              : '…'}
          </p>
        </div>
        <div className="text-center">
          <p className="text-2xs text-slate-600 uppercase font-semibold tracking-wider mb-0.5">AI Vis.</p>
          <p className="text-xs font-bold text-white tabular-nums">
            {summary && !summary.loading
              ? summary.aiVisibility != null
                ? `${summary.aiVisibility}%`
                : '—'
              : '…'}
          </p>
        </div>
        <div className="text-center">
          <p className="text-2xs text-slate-600 uppercase font-semibold tracking-wider mb-0.5">Backlinks</p>
          <p className="text-xs font-bold text-white tabular-nums">
            {summary && !summary.loading
              ? formatNumber(summary.backlinks)
              : '…'}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-600">{timeAgo(project.createdAt)}</span>
        <span className="text-[10px] text-indigo-400 group-hover:text-indigo-300 font-medium transition-colors">
          Open →
        </span>
      </div>
      </CardBody>
    </Card>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [summaries, setSummaries] = useState<Record<string, ProjectSummary>>({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Project[]>('/projects')
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : [];
        setProjects(list);
        return list;
      })
      .catch(() => {
        setError('Failed to load projects.');
        return [] as Project[];
      })
      .finally(() => setLoading(false));
  }, []);

  const fetchSummaries = useCallback(async (list: Project[]) => {
    const results = await Promise.allSettled(
      list.map((p) =>
        fetchProjectSummary(p._id).then((s) => ({ id: p._id, summary: s })),
      ),
    );
    const map: Record<string, ProjectSummary> = {};
    for (const r of results) {
      if (r.status === 'fulfilled') {
        map[r.value.id] = r.value.summary;
      }
    }
    setSummaries((prev) => ({ ...prev, ...map }));
  }, []);

  useEffect(() => {
    if (projects.length > 0) {
      fetchSummaries(projects);
    }
  }, [projects, fetchSummaries]);

  const handleCreate = (p: Project) => {
    setProjects((prev) => [p, ...prev]);
    setShowModal(false);
    navigate(`/projects/${p._id}`);
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {projects.length === 0 && !loading
              ? 'Your projects will appear here'
              : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Button
          id="new-project-btn"
          onClick={() => setShowModal(true)}
          className="rounded-xl py-2.5 shadow-indigo-600/30"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New Project
        </Button>
      </div>

      {error && (
        <div className="mb-6 bg-red-950/60 border border-red-800/50 text-red-300 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardBody>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-9 w-9 rounded-xl bg-slate-800" />
                <div className="flex-1">
                  <div className="h-3 w-2/3 bg-slate-800 rounded mb-1.5" />
                  <div className="h-2.5 w-1/2 bg-slate-800 rounded" />
                </div>
              </div>
              <div className="h-14 bg-slate-800/60 rounded-xl mb-3" />
              <div className="h-2.5 w-1/3 bg-slate-800 rounded" />
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {!loading && projects.length === 0 && (
        <EmptyState
          icon={<FolderSearch className="h-8 w-8" />}
          title="Ready to boost your search visibility?"
          description="Add your first site and we'll scan up to 5,000 pages to find what's holding back your AI Overview rankings."
          action={
            <Button
              onClick={() => setShowModal(true)}
              className="rounded-xl py-2.5 px-5 shadow-indigo-600/30"
            >
              Add your first site
            </Button>
          }
        />
      )}

      {!loading && projects.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <ProjectCard
              key={p._id}
              project={p}
              summary={summaries[p._id] ?? null}
              onClick={() => navigate(`/projects/${p._id}`)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <NewProjectModal onClose={() => setShowModal(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}
