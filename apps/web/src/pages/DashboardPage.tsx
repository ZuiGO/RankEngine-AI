import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderSearch, Search, ArrowRight, Globe, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../lib/api';
import { Card, CardBody, Badge, Button, EmptyState, Modal } from '../components/ui';
import { stagger, listItem } from '../lib/motion';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Project {
  _id: string;
  name: string;
  domain: string;
  stagingDomain?: string;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

/** Normalise a user-typed string into a clean domain for display */
function displayDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

// ─── URL Hero Input ───────────────────────────────────────────────────────────

function UrlHero({ onNavigate }: { onNavigate: (projectId: string) => void }) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus on mount
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    // Auto-prepend https:// if user typed bare domain
    const fullUrl =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`;

    setStatus('loading');
    setErrorMsg('');

    try {
      // 1. Try to find an existing project for this domain
      try {
        const { data } = await api.get<Project>(`/projects/by-domain?url=${encodeURIComponent(fullUrl)}`);
        onNavigate(data._id);
        return;
      } catch (lookupErr: any) {
        // 404 means "not found" → create new project
        if (lookupErr?.response?.status !== 404) {
          throw lookupErr;
        }
      }

      // 2. Create a new project and trigger first audit
      const domain = displayDomain(fullUrl);
      const name = domain.split('.').slice(-2, -1)[0] ?? domain; // e.g. "acme" from "acme.io"
      const capitalised = name.charAt(0).toUpperCase() + name.slice(1);

      const { data: newProject } = await api.post<Project>('/projects', {
        name: capitalised,
        domain: fullUrl,
        triggerFirstAudit: true,
      });

      onNavigate(newProject._id);
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ??
        err?.response?.data?.message ??
        'Something went wrong. Please try again.';
      setErrorMsg(msg);
      setStatus('error');
    }
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
        {/* URL input */}
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
            <Globe className="h-4 w-4 text-app-text-muted" />
          </div>
          <input
            ref={inputRef}
            id="url-analyze-input"
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setStatus('idle'); setErrorMsg(''); }}
            disabled={status === 'loading'}
            placeholder="https://example.com"
            className="w-full bg-app-surface border border-app-border rounded-xl pl-10 pr-4 py-3.5 text-sm text-white placeholder-app-text-muted focus:outline-none focus:border-app-signal focus:ring-2 focus:ring-app-signal/20 transition-all disabled:opacity-60"
            autoComplete="url"
          />
        </div>

        {/* Submit button */}
        <button
          id="url-analyze-btn"
          type="submit"
          disabled={status === 'loading' || !url.trim()}
          className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-app-signal text-app-base font-semibold text-sm hover:bg-app-signal/90 focus:outline-none focus:ring-2 focus:ring-app-signal/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-app-signal/25 flex-shrink-0"
        >
          {status === 'loading' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Search className="h-4 w-4" />
              Analyze
              <ArrowRight className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      </form>

      {/* Status */}
      <AnimatePresence>
        {status === 'loading' && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 text-xs text-app-text-muted flex items-center gap-2"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-app-signal" />
            Looking up domain…
          </motion.p>
        )}
        {status === 'error' && errorMsg && (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 text-xs text-rose-400 flex items-center gap-2"
          >
            <span className="inline-block h-3.5 w-3.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-center leading-3.5">!</span>
            {errorMsg}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── New Project Modal (kept for manual override) ────────────────────────────

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
    <Modal open onClose={onClose} title="New Project">
      <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
        {error && (
          <div className="bg-rose-950/40 border border-rose-800/30 text-rose-300 text-sm rounded-lg px-4 py-2.5">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-app-text-muted mb-1.5" htmlFor="modal-project-name">
            Project name <span className="text-red-400">*</span>
          </label>
          <input
            id="modal-project-name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-app-surface border border-app-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-app-text-muted focus:outline-none focus:border-app-signal focus:ring-1 focus:ring-app-signal/30 transition-colors"
            placeholder="My Website SEO"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-app-text-muted mb-1.5" htmlFor="modal-project-domain">
            Live domain <span className="text-red-400">*</span>
          </label>
          <input
            id="modal-project-domain"
            type="text"
            required
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            className="w-full bg-app-surface border border-app-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-app-text-muted focus:outline-none focus:border-app-signal focus:ring-1 focus:ring-app-signal/30 transition-colors"
            placeholder="example.com"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-app-text-muted mb-1.5" htmlFor="modal-project-staging">
            Staging domain <span className="text-app-text-muted/60 font-normal">(optional)</span>
          </label>
          <input
            id="modal-project-staging"
            type="text"
            value={stagingDomain}
            onChange={(e) => setStagingDomain(e.target.value)}
            className="w-full bg-app-surface border border-app-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-app-text-muted focus:outline-none focus:border-app-signal focus:ring-1 focus:ring-app-signal/30 transition-colors"
            placeholder="staging.example.com"
          />
        </div>

        <div className="flex gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1 py-2.5">
            Cancel
          </Button>
          <Button
            id="create-project-submit-btn"
            type="submit"
            loading={loading}
            className="flex-1 py-2.5 disabled:opacity-60 shadow-app-signal/30"
          >
            {loading ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Project Card (Recent Reports row) ───────────────────────────────────────

function RecentProjectCard({
  project,
  onClick,
}: {
  project: Project;
  onClick: () => void;
}) {
  return (
    <Card
      className="group hover:border-app-signal/30 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-lg"
      onClick={onClick}
    >
      <CardBody className="py-3.5 px-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-indigo-700/40 to-violet-700/40 border border-indigo-700/20 flex items-center justify-center text-indigo-300 font-bold text-xs flex-shrink-0">
            {project.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-white group-hover:text-app-signal transition-colors truncate">
              {project.name}
            </h3>
            <p className="text-xs text-app-text-muted truncate font-mono">{displayDomain(project.domain)}</p>
          </div>
          <div className="flex-shrink-0 flex items-center gap-2">
            {project.stagingDomain && (
              <Badge variant="warning" className="text-[10px]">Staging</Badge>
            )}
            <span className="text-[10px] text-app-text-muted">{timeAgo(project.createdAt)}</span>
            <ArrowRight className="h-3.5 w-3.5 text-app-signal opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [recentExpanded, setRecentExpanded] = useState(false);

  const RECENT_LIMIT = 5;

  useEffect(() => {
    api
      .get<Project[]>('/projects')
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : [];
        setProjects(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = (p: Project) => {
    setProjects((prev) => [p, ...prev]);
    setShowModal(false);
    navigate(`/projects/${p._id}`);
  };

  const visibleProjects = recentExpanded ? projects : projects.slice(0, RECENT_LIMIT);

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">

      {/* ── Hero: URL Input ── */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.33, 1, 0.68, 1] }}
      >
        {/* Ambient glow */}
        <div className="relative">
          <div className="absolute -inset-8 bg-gradient-to-br from-app-signal/8 via-transparent to-transparent rounded-3xl pointer-events-none" />

          <div className="relative bg-app-surface border border-app-border rounded-2xl p-7 shadow-xl shadow-black/30">
            {/* Heading */}
            <div className="mb-6">
              <div className="inline-flex items-center gap-2 bg-app-signal/10 border border-app-signal/20 rounded-full px-3 py-1 mb-4">
                <span className="h-1.5 w-1.5 rounded-full bg-app-signal animate-pulse" />
                <span className="text-[11px] font-semibold text-app-signal uppercase tracking-wider">SEO Analyzer</span>
              </div>
              <h1 className="text-2xl font-bold font-display text-white leading-tight">
                Paste a URL.<br />
                <span className="text-app-signal">Get your full SEO report.</span>
              </h1>
              <p className="text-sm text-app-text-muted mt-2 leading-relaxed">
                We'll crawl your site, score every page, check backlinks, and flag critical issues — all in one view.
              </p>
            </div>

            {/* The hero input */}
            <UrlHero onNavigate={(id) => navigate(`/projects/${id}`)} />

            {/* Manual override link */}
            <div className="mt-4 flex items-center gap-2">
              <div className="flex-1 h-px bg-app-border" />
              <button
                id="manual-project-btn"
                onClick={() => setShowModal(true)}
                className="text-[11px] text-app-text-muted hover:text-app-text transition-colors px-3 flex-shrink-0"
              >
                or set up project manually
              </button>
              <div className="flex-1 h-px bg-app-border" />
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Recent Reports ── */}
      {(loading || projects.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15, ease: [0.33, 1, 0.68, 1] }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <FolderSearch className="h-4 w-4 text-app-text-muted" />
              Recent Reports
            </h2>
            {projects.length > 0 && (
              <span className="text-[11px] text-app-text-muted">
                {projects.length} project{projects.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Loading skeleton */}
          {loading && (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-14 bg-app-surface border border-app-border rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          {/* Project list */}
          {!loading && (
            <>
              <motion.div
                className="space-y-2"
                variants={stagger}
                initial="hidden"
                animate="visible"
              >
                {visibleProjects.map((p) => (
                  <motion.div key={p._id} variants={listItem}>
                    <RecentProjectCard
                      project={p}
                      onClick={() => navigate(`/projects/${p._id}`)}
                    />
                  </motion.div>
                ))}
              </motion.div>

              {/* Show more / less toggle */}
              {projects.length > RECENT_LIMIT && (
                <button
                  onClick={() => setRecentExpanded((v) => !v)}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 py-2.5 text-xs text-app-text-muted hover:text-white border border-app-border hover:border-slate-700 rounded-xl transition-all"
                >
                  {recentExpanded ? (
                    <><ChevronUp className="h-3.5 w-3.5" /> Show fewer</>
                  ) : (
                    <><ChevronDown className="h-3.5 w-3.5" /> Show all {projects.length} reports</>
                  )}
                </button>
              )}
            </>
          )}
        </motion.div>
      )}

      {/* ── First-time empty state ── */}
      {!loading && projects.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <EmptyState
            icon={<Globe className="h-7 w-7" />}
            title="No reports yet"
            description="Paste any URL above to run your first site audit. It takes about 30–60 seconds to crawl and score your pages."
          />
        </motion.div>
      )}

      {showModal && (
        <NewProjectModal onClose={() => setShowModal(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}
