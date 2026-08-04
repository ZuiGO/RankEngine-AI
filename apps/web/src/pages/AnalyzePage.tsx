import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Globe,
  Search,
  ArrowRight,
  Loader2,
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Shield,
  Check,
  X,
  Layers,
} from 'lucide-react';
import api from '../lib/api';
import { Card, Badge, Button } from '../components/ui';
import ChatPanel from '../components/ChatPanel';

// ─── Interfaces matching backend API ─────────────────────────────────────────

export interface SiteReportIssue {
  severity: 'critical' | 'warning' | 'passed';
  category: string;
  description: string;
}

export interface PageContentItem {
  _id?: string;
  contentType: 'text' | 'image' | 'video' | 'pdf' | 'docx' | 'pptx' | 'xlsx';
  sourceUrl: string;
  altText?: string;
  extractionStatus: 'pending' | 'success' | 'failed' | 'unsupported';
  extractionError?: string;
  extractedText?: string;
  extractedTables?: { sheetName?: string; headers?: string[]; rows?: string[][] }[];
  extractedImages?: { storagePath: string }[];
  hasTranscript?: boolean;
  storagePath?: string;
}

export interface SiteReportPageItem {
  url: string;
  issues: SiteReportIssue[];
  content?: PageContentItem[];
}

export interface SiteReportCounts {
  pageCount: number;
  totalLinks: number;
  totalHyperlinks: number;
  internalLinks: number;
  backlinkCount: number;
  pdfCount?: number;
  videoCount?: number;
  imageCount?: number;
  documentCount?: number;
}

export interface SiteReport {
  projectId: string;
  generatedAt: string;
  counts: SiteReportCounts;
  pages: SiteReportPageItem[];
}

export interface ActionItem {
  contentId: string;
  pageUrl: string;
  impactOnRanking: string;
  identifiedIssues: string;
  howToImprove: string;
  status: 'open' | 'proposed' | 'approved' | 'applied';
}

export interface SiteReportData {
  report: SiteReport;
  actionItems: ActionItem[];
}

interface Project {
  _id: string;
  name: string;
  domain: string;
}

interface CrawlJob {
  _id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  pageCount: number;
}

function displayDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

// ─── Pre-populated Sample Demo Site Report ──────────────────────────────────

const SAMPLE_DEMO_REPORT: SiteReportData = {
  report: {
    projectId: 'demo-sample-project',
    generatedAt: new Date().toISOString(),
    counts: {
      pageCount: 18,
      totalLinks: 142,
      totalHyperlinks: 120,
      internalLinks: 86,
      backlinkCount: 340,
      pdfCount: 4,
      videoCount: 2,
      imageCount: 28,
      documentCount: 6,
    },
    pages: [
      {
        url: 'https://example-demo.com/blog/technical-seo-guide',
        issues: [
          { severity: 'critical', category: 'seo-title', description: 'Missing H1 heading tag and duplicate title tag' },
          { severity: 'warning', category: 'canonical', description: 'Canonical URL points to non-HTTPS scheme' },
          { severity: 'passed', category: 'meta-description', description: 'Meta description present (154 characters)' },
        ],
        content: [
          {
            contentType: 'pdf',
            sourceUrl: 'https://example-demo.com/assets/seo-cheat-sheet.pdf',
            extractionStatus: 'success',
            extractedText: 'Comprehensive Technical SEO Checklist 2026 for Enterprise Web Applications.',
            extractedTables: [
              {
                sheetName: 'Ranking Factors',
                headers: ['Factor', 'Impact Score', 'Optimization Priority'],
                rows: [
                  ['Page Speed (LCP)', 'High', 'Crucial'],
                  ['Internal Link Hierarchy', 'High', 'Important'],
                  ['Structured Data Schema', 'Medium', 'Recommended'],
                ],
              },
            ],
          },
          {
            contentType: 'video',
            sourceUrl: 'https://example-demo.com/videos/product-overview.mp4',
            hasTranscript: true,
            extractionStatus: 'success',
            extractedText: 'Transcript: Welcome to RankEngine AI single-pipeline automated site analysis demo.',
          },
        ],
      },
      {
        url: 'https://example-demo.com/products/rank-tracker',
        issues: [
          { severity: 'critical', category: 'orphan-page', description: 'Orphan page detected in Neo4j Graph — zero internal incoming links' },
          { severity: 'warning', category: 'image-alt', description: '3 images missing descriptive alt tags' },
        ],
        content: [
          {
            contentType: 'image',
            sourceUrl: 'https://example-demo.com/images/dashboard-hero.png',
            altText: 'RankEngine AI Dashboard Mockup',
            extractionStatus: 'success',
          },
        ],
      },
    ],
  },
  actionItems: [
    {
      contentId: 'action-orphan-101',
      pageUrl: 'https://example-demo.com/products/rank-tracker',
      impactOnRanking: 'Crucial internal page indexability boost',
      identifiedIssues: 'orphan-page — Graph DB detected 0 incoming internal links',
      howToImprove: 'Add contextual internal links from blog and header navigation',
      status: 'proposed',
    },
    {
      contentId: 'action-pdf-102',
      pageUrl: 'https://example-demo.com/blog/technical-seo-guide',
      impactOnRanking: 'Indexable PDF table content keyword signals',
      identifiedIssues: 'pdf-table — PDF contains unindexed tabular keyword data',
      howToImprove: 'Convert PDF ranking factor table into HTML table on target page',
      status: 'proposed',
    },
    {
      contentId: 'action-title-103',
      pageUrl: 'https://example-demo.com/blog/technical-seo-guide',
      impactOnRanking: 'Primary search engine ranking title tag',
      identifiedIssues: 'seo-title — H1 heading tag missing',
      howToImprove: 'Add <h1>Technical SEO Guide 2026</h1> to main template',
      status: 'proposed',
    },
  ],
};

// ─── Main AnalyzePage Component ──────────────────────────────────────────────

export default function AnalyzePage({ initialProjectId }: { initialProjectId?: string } = {}) {
  const { id: routeProjectId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [inputUrl, setInputUrl] = useState('');
  const [projectId, setProjectId] = useState<string | null>(initialProjectId || routeProjectId || null);
  const [activeJob, setActiveJob] = useState<CrawlJob | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [reportData, setReportData] = useState<SiteReportData | null>(null);
  const [activeSection, setActiveSection] = useState<'Overview' | 'Pages' | 'Action Items' | 'Content' | 'All'>('Overview');
  const [pendingApprovalWarning, setPendingApprovalWarning] = useState<{
    contentId: string;
    warnings: string[];
  } | null>(null);

  const [expandedPages, setExpandedPages] = useState<Record<string, boolean>>({});
  const [expandedContentItems, setExpandedContentItems] = useState<Record<string, boolean>>({});

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleLoadDemoReport = () => {
    setInputUrl('https://example-demo.com');
    setProjectId('demo-sample-project');
    setReportData(SAMPLE_DEMO_REPORT);
    setErrorMsg('');
    setActiveJob(null);
    setExpandedPages({ 'https://example-demo.com/blog/technical-seo-guide': true, 'https://example-demo.com/products/rank-tracker': true });
    setExpandedContentItems({ 'https://example-demo.com/blog/technical-seo-guide-content-0': true });
  };

  // Synchronize routeProjectId with local state
  useEffect(() => {
    if (routeProjectId) {
      setProjectId(routeProjectId);
    }
  }, [routeProjectId]);

  // Load report data whenever routeProjectId or projectId is available
  useEffect(() => {
    const targetId = routeProjectId || projectId;
    if (targetId) {
      fetchReport(targetId);
    }
  }, [routeProjectId, projectId]);

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const fetchReport = async (pid: string) => {
    setLoadingReport(true);
    setErrorMsg('');
    try {
      const res = await api.get<SiteReportData>(`/projects/${pid}/report`);
      if (res && res.data) {
        setReportData(res.data);
        setActiveJob(null);
      }
    } catch (err: any) {
      console.log('fetchReport error:', err);
      const code = err?.response?.data?.code;
      if (code === 'NO_COMPLETED_CRAWL' || err?.response?.status === 400) {
        checkCrawlStatus(pid);
      } else {
        setErrorMsg(err?.response?.data?.error || err?.message || 'Failed to load report');
      }
    } finally {
      setLoadingReport(false);
    }
  };

  const checkCrawlStatus = async (pid: string) => {
    try {
      const { data } = await api.get<{ latestJob: CrawlJob | null }>(`/projects/${pid}/latest-crawl`);
      if (data.latestJob) {
        setActiveJob(data.latestJob);
        if (data.latestJob.status === 'running' || data.latestJob.status === 'queued') {
          startPolling(pid, data.latestJob._id);
        }
      }
    } catch {
      // Ignore
    }
  };

  const startPolling = (pid: string, jobId: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const { data: job } = await api.get<CrawlJob>(`/crawl-jobs/${jobId}`);
        setActiveJob(job);
        if (job.status === 'completed') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          fetchReport(pid);
        } else if (job.status === 'failed') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setErrorMsg('Crawl job failed. Please try running audit again.');
        }
      } catch {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      }
    }, 1500);
  };

  const handleAnalyzeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = inputUrl.trim();
    if (!trimmed || analyzing) return;

    const fullUrl =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`;

    setAnalyzing(true);
    setErrorMsg('');
    setReportData(null);

    try {
      let targetProjectId = '';

      // 1. Check if domain exists
      try {
        const { data: existing } = await api.get<Project>(`/projects/by-domain?url=${encodeURIComponent(fullUrl)}`);
        targetProjectId = existing._id;
      } catch (err: any) {
        if (err?.response?.status !== 404) throw err;
      }

      // 2. If project does not exist, create it
      if (!targetProjectId) {
        const domain = displayDomain(fullUrl);
        const namePart = domain.split('.').slice(-2, -1)[0] || domain;
        const name = namePart.charAt(0).toUpperCase() + namePart.slice(1);

        const { data: newProj } = await api.post<Project>('/projects', {
          name,
          domain: fullUrl,
          triggerFirstAudit: true,
        });
        targetProjectId = newProj._id;
      }

      setProjectId(targetProjectId);
      navigate(`/projects/${targetProjectId}`);

      // 3. Trigger audit if no crawl active
      const { data: crawlRes } = await api.post<{ crawlJobId: string }>(`/projects/${targetProjectId}/crawl`);
      startPolling(targetProjectId, crawlRes.crawlJobId);
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.error || 'Failed to analyze URL');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRunAudit = async () => {
    if (!projectId) return;
    setAnalyzing(true);
    setErrorMsg('');
    try {
      const { data: crawlRes } = await api.post<{ crawlJobId: string }>(`/projects/${projectId}/crawl`);
      setActiveJob({ _id: crawlRes.crawlJobId, status: 'queued', pageCount: 0 });
      startPolling(projectId, crawlRes.crawlJobId);
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.error || 'Failed to trigger audit');
    } finally {
      setAnalyzing(false);
    }
  };

  // ── Action item approval / rejection handlers ──
  const handleApproveAction = async (contentId: string, skipWarningCheck = false) => {
    try {
      const endpoint = projectId
        ? `/projects/${projectId}/pending-changes/${contentId}/approve`
        : `/pending-changes/${contentId}/approve`;
      const res = await api.post<any>(endpoint);
      const data = res?.data || {};

      if (!skipWarningCheck && data.previewWarning && Array.isArray(data.previewWarning) && data.previewWarning.length > 0) {
        // Display preview verification warning before final publish confirmation!
        setPendingApprovalWarning({
          contentId,
          warnings: data.previewWarning,
        });
        return;
      }

      setPendingApprovalWarning(null);
      setReportData((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          actionItems: prev.actionItems.map((item) =>
            item.contentId === contentId ? { ...item, status: 'approved' } : item
          ),
        };
      });
    } catch (err: any) {
      console.error('Approve failed:', err);
    }
  };

  const handleRejectAction = async (contentId: string) => {
    try {
      if (projectId) {
        await api.post(`/projects/${projectId}/pending-changes/${contentId}/reject`);
      } else {
        await api.post(`/pending-changes/${contentId}/reject`);
      }
      setReportData((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          actionItems: prev.actionItems.map((item) =>
            item.contentId === contentId ? { ...item, status: 'open' } : item
          ),
        };
      });
    } catch (err: any) {
      console.error('Reject failed:', err);
    }
  };

  const togglePageExpand = (url: string) => {
    setExpandedPages((prev) => ({ ...prev, [url]: !prev[url] }));
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      {/* ── Primary Action: Hero URL Input Bar ── */}
      <Card className="p-6 bg-app-surface border-app-border shadow-xl">
        <div className="mb-4">
          <div className="inline-flex items-center gap-2 bg-app-signal/10 border border-app-signal/20 rounded-full px-3 py-1 mb-2">
            <span className="h-1.5 w-1.5 rounded-full bg-app-signal animate-pulse" />
            <span className="text-[11px] font-semibold text-app-signal uppercase tracking-wider">SEO Auditor</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold font-display text-white">
            Analyze Any Website
          </h1>
          <p className="text-xs text-app-text-muted mt-1">
            Paste a URL to generate a consolidated report covering page SEO, internal linking, and action items.
          </p>
        </div>

        <form onSubmit={handleAnalyzeSubmit} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
              <Globe className="h-4 w-4 text-app-text-muted" />
            </div>
            <input
              ref={inputRef}
              id="url-analyze-input"
              data-testid="url-analyze-input"
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              disabled={analyzing}
              placeholder="https://example.com"
              className="w-full bg-app-base border border-app-border rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-app-text-muted focus:outline-none focus:border-app-signal focus:ring-1 focus:ring-app-signal/30 transition-all"
            />
          </div>

          <button
            id="url-analyze-btn"
            data-testid="url-analyze-btn"
            type="submit"
            disabled={analyzing || !inputUrl.trim()}
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-app-signal text-app-base font-semibold text-sm hover:bg-app-signal/90 focus:outline-none disabled:opacity-50 transition-all shadow-md shadow-app-signal/20"
          >
            {analyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Search className="h-4 w-4" />
                Analyze
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </button>

          <button
            type="button"
            id="try-demo-btn"
            data-testid="try-demo-btn"
            onClick={handleLoadDemoReport}
            className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold text-sm hover:bg-emerald-500/20 transition-all"
          >
            <Layers className="h-4 w-4" />
            Try Demo Site
          </button>
        </form>

        {errorMsg && (
          <div className="mt-3 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/30 rounded-lg px-3 py-2">
            {errorMsg}
          </div>
        )}
      </Card>

      {/* ── Active Crawl Progress Banner ── */}
      {activeJob && (activeJob.status === 'running' || activeJob.status === 'queued') && (
        <Card className="p-5 bg-indigo-950/30 border-indigo-700/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 text-indigo-400 animate-spin" />
              <div>
                <p className="text-sm font-semibold text-white">Crawling Website in Progress…</p>
                <p className="text-xs text-app-text-muted">
                  Scanned {activeJob.pageCount} pages. Assembling audit report and action items...
                </p>
              </div>
            </div>
            <Badge variant="warning">{activeJob.status}</Badge>
          </div>
        </Card>
      )}

      {/* ── Loading Report Skeleton ── */}
      {loadingReport && !reportData && (
        <div className="space-y-4 animate-pulse">
          <div className="h-24 bg-app-surface border border-app-border rounded-xl" />
          <div className="h-48 bg-app-surface border border-app-border rounded-xl" />
          <div className="h-64 bg-app-surface border border-app-border rounded-xl" />
        </div>
      )}

      {/* ── No Audit Completed State ── */}
      {!loadingReport && !reportData && !activeJob && (
        <Card className="p-8 text-center space-y-4 border-app-border bg-app-surface/50">
          <div className="mx-auto h-12 w-12 rounded-full bg-app-signal/10 border border-app-signal/20 flex items-center justify-center text-app-signal">
            <FileText className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">No Audit Report Ready</h3>
            <p className="text-xs text-app-text-muted mt-1 max-w-md mx-auto">
              Enter a website URL above to trigger a fresh automated audit, or click below to explore an instant demo report with extracted PDF tables, video transcripts, and orphan page graph checks.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            {projectId && (
              <Button id="run-audit-btn" onClick={handleRunAudit} className="rounded-xl py-2.5 px-5 text-xs">
                Run Audit Now
              </Button>
            )}
            <button
              id="try-demo-state-btn"
              data-testid="try-demo-state-btn"
              onClick={handleLoadDemoReport}
              className="px-5 py-2.5 bg-emerald-500 text-black font-bold rounded-xl text-xs hover:bg-emerald-400 transition-colors shadow-md"
            >
              Load Instant Demo Site Report
            </button>
          </div>
        </Card>
      )}

      {/* ── Consolidated Report View ── */}
      {reportData && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-8"
        >
          {/* Section Navigation Tabs for Auto-Scoping Chat Context */}
          <div className="flex items-center gap-2 border-b border-app-border pb-3" data-testid="report-section-tabs">
            {(['Overview', 'Pages', 'Action Items', 'Content', 'All'] as const).map((sec) => (
              <button
                key={sec}
                data-testid={`section-tab-${sec.toLowerCase().replace(/\s+/g, '-')}`}
                onClick={() => setActiveSection(sec)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeSection === sec
                    ? 'bg-app-signal text-app-base shadow-sm'
                    : 'bg-app-surface border border-app-border text-app-text-muted hover:text-white'
                }`}
              >
                {sec}
              </button>
            ))}
          </div>

          {/* Pre-Publish Preview Verification Warning Banner (surfaced before final confirm publish action) */}
          {pendingApprovalWarning && (
            <Card data-testid="preview-warning-banner" className="p-4 bg-amber-950/60 border border-amber-500/40 space-y-3">
              <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
                <AlertTriangle className="h-4 w-4" />
                Pre-Publish Preview Verification Warnings
              </div>
              <p className="text-xs text-amber-200/80">
                The targeted preview crawl detected potential issues before publishing:
              </p>
              <ul className="text-xs text-amber-200/90 list-disc pl-5 space-y-1 font-mono">
                {pendingApprovalWarning.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
              <div className="flex items-center gap-2 pt-2 border-t border-amber-500/20">
                <button
                  data-testid="confirm-publish-btn"
                  onClick={() => handleApproveAction(pendingApprovalWarning.contentId, true)}
                  className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg text-xs transition-colors shadow-sm"
                >
                  Confirm & Publish Anyway
                </button>
                <button
                  onClick={() => setPendingApprovalWarning(null)}
                  className="px-3.5 py-1.5 bg-app-base border border-app-border text-app-text-muted rounded-lg text-xs hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </Card>
          )}

          {/* SECTION 1: Overview (5 Counts Stat Row) */}
          {(activeSection === 'Overview' || activeSection === 'All') && (
            <div id="overview-section" data-testid="overview-section">
              <h2 className="text-base font-bold font-display text-white mb-3 flex items-center gap-2">
                <Layers className="h-4 w-4 text-app-signal" />
                Report Overview
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <Card className="p-4 bg-app-surface border-app-border">
                  <p className="text-2xs text-app-text-muted uppercase font-semibold">Total Pages</p>
                  <p className="text-xl font-bold text-white mt-1 tabular-nums">
                    {reportData.report.counts.pageCount.toLocaleString()}
                  </p>
                </Card>
                <Card className="p-4 bg-app-surface border-app-border">
                  <p className="text-2xs text-app-text-muted uppercase font-semibold">Total Links</p>
                  <p className="text-xl font-bold text-white mt-1 tabular-nums">
                    {reportData.report.counts.totalLinks.toLocaleString()}
                  </p>
                </Card>
                <Card className="p-4 bg-app-surface border-app-border">
                  <p className="text-2xs text-app-text-muted uppercase font-semibold">Hyperlinks</p>
                  <p className="text-xl font-bold text-white mt-1 tabular-nums">
                    {reportData.report.counts.totalHyperlinks.toLocaleString()}
                  </p>
                </Card>
                <Card className="p-4 bg-app-surface border-app-border">
                  <p className="text-2xs text-app-text-muted uppercase font-semibold">Internal Links</p>
                  <p className="text-xl font-bold text-white mt-1 tabular-nums">
                    {reportData.report.counts.internalLinks.toLocaleString()}
                  </p>
                </Card>
                <Card className="p-4 bg-app-surface border-app-border">
                  <p className="text-2xs text-app-text-muted uppercase font-semibold">Backlinks</p>
                  <p className="text-xl font-bold text-indigo-400 mt-1 tabular-nums">
                    {reportData.report.counts.backlinkCount.toLocaleString()}
                  </p>
                </Card>
              </div>
            </div>
          )}

          {/* SECTION 2: Pages (Expandable List with Issues) */}
          <div id="pages-section" data-testid="pages-section">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold font-display text-white flex items-center gap-2">
                <FileText className="h-4 w-4 text-emerald-400" />
                Audited Pages ({reportData.report.pages.length})
              </h2>
            </div>

            {reportData.report.pages.length === 0 ? (
              <Card className="p-4 text-center text-xs text-app-text-muted">No page issues found.</Card>
            ) : (
              <div className="space-y-2">
                {reportData.report.pages.map((page, idx) => {
                  const isExpanded = !!expandedPages[page.url || idx];
                  const criticals = page.issues.filter((i) => i.severity === 'critical').length;
                  const warnings = page.issues.filter((i) => i.severity === 'warning').length;
                  const passes = page.issues.filter((i) => i.severity === 'passed').length;

                  return (
                    <Card key={page.url || idx} className="border-app-border overflow-hidden">
                      <button
                        data-testid={`page-expand-btn-${idx}`}
                        onClick={() => togglePageExpand(page.url || String(idx))}
                        className="w-full px-4 py-3 bg-app-surface hover:bg-app-surface/80 flex items-center justify-between text-left transition-colors"
                      >
                        <div className="flex items-center gap-2 truncate min-w-0 pr-2">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-app-text-muted flex-shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-app-text-muted flex-shrink-0" />
                          )}
                          <span data-testid={`page-url-${idx}`} className="text-xs font-mono text-white truncate">{page.url}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 text-2xs font-semibold">
                          {criticals > 0 && (
                            <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded-full">
                              {criticals} critical
                            </span>
                          )}
                          {warnings > 0 && (
                            <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                              {warnings} warning
                            </span>
                          )}
                          {passes > 0 && (
                            <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                              {passes} passed
                            </span>
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="p-4 border-t border-app-border bg-app-base space-y-3">
                          {page.issues.map((issue, issueIdx) => (
                            <div
                              key={issueIdx}
                              className="flex items-start gap-2.5 p-2.5 rounded-lg bg-app-surface border border-app-border/60 text-xs"
                            >
                              {issue.severity === 'critical' ? (
                                <XCircle className="h-4 w-4 text-rose-400 flex-shrink-0 mt-0.5" />
                              ) : issue.severity === 'warning' ? (
                                <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="font-semibold text-white uppercase text-[10px] tracking-wide">
                                    {issue.category}
                                  </span>
                                </div>
                                <p className="text-app-text-muted leading-relaxed">{issue.description}</p>
                              </div>
                            </div>
                          ))}

                          {page.content && page.content.length > 0 && (
                            <div className="mt-4 pt-3 border-t border-app-border" data-testid={`content-inventory-${idx}`}>
                              <h4 className="text-xs font-semibold text-white mb-2 flex items-center gap-1.5">
                                <FileText className="h-3.5 w-3.5 text-app-signal" />
                                Content Inventory ({page.content.length})
                              </h4>
                              <div className="space-y-2">
                                {page.content.map((cItem, cIdx) => {
                                  const cKey = `${page.url || idx}-content-${cIdx}`;
                                  const isContentExpanded = !!expandedContentItems[cKey];

                                  return (
                                    <div
                                      key={cIdx}
                                      className="p-2.5 rounded-lg bg-app-surface border border-app-border/60 text-xs space-y-2"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 truncate min-w-0">
                                          <Badge
                                            variant="default"
                                            data-testid={`content-badge-${cItem.contentType}`}
                                            className="uppercase text-[10px] px-1.5 py-0.2"
                                          >
                                            {cItem.contentType}
                                          </Badge>
                                          <span className="font-mono text-[11px] text-white truncate">
                                            {cItem.sourceUrl}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                          <Badge
                                            variant={cItem.extractionStatus === 'success' ? 'success' : cItem.extractionStatus === 'failed' ? 'danger' : 'warning'}
                                            className="text-[10px]"
                                          >
                                            {cItem.extractionStatus}
                                          </Badge>

                                          {cItem.contentType === 'pdf' && (
                                            <span className="text-[10px] text-app-text-muted">
                                              {cItem.extractedTables?.length || 0} tables, {cItem.extractedImages?.length || 0} imgs
                                            </span>
                                          )}

                                          {cItem.contentType === 'video' && (
                                            <span className={`text-[10px] ${cItem.hasTranscript ? 'text-emerald-400' : 'text-amber-400'}`}>
                                              {cItem.hasTranscript ? 'Transcript found' : 'No transcript'}
                                            </span>
                                          )}

                                          {(cItem.extractedText || (cItem.extractedTables && cItem.extractedTables.length > 0)) && (
                                            <button
                                              data-testid={`view-content-${idx}-${cIdx}`}
                                              onClick={() =>
                                                setExpandedContentItems((prev) => ({
                                                  ...prev,
                                                  [cKey]: !prev[cKey],
                                                }))
                                              }
                                              className="text-[10px] text-app-signal hover:underline flex items-center gap-0.5 ml-1"
                                            >
                                              {isContentExpanded ? 'Hide Data' : 'View Extracted Data'}
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      {isContentExpanded && (
                                        <div className="p-3 mt-2 bg-app-base border border-app-border rounded-md space-y-3 font-mono text-[11px]" data-testid={`extracted-data-view-${idx}-${cIdx}`}>
                                          {cItem.extractedText && (
                                            <div>
                                              <h5 className="text-[10px] uppercase font-sans font-semibold text-app-text-muted mb-1">Extracted Text:</h5>
                                              <div className="bg-app-surface p-2 rounded max-h-40 overflow-y-auto text-app-text-muted leading-relaxed whitespace-pre-wrap">
                                                {cItem.extractedText}
                                              </div>
                                            </div>
                                          )}

                                          {cItem.extractedTables && cItem.extractedTables.length > 0 && (
                                            <div className="space-y-2">
                                              <h5 className="text-[10px] uppercase font-sans font-semibold text-app-text-muted mb-1">Extracted Tables ({cItem.extractedTables.length}):</h5>
                                              {cItem.extractedTables.map((tbl, tIdx) => (
                                                <div key={tIdx} className="overflow-x-auto border border-app-border rounded">
                                                  <table className="w-full text-left text-[11px]" data-testid={`extracted-table-${tIdx}`}>
                                                    <caption className="bg-app-surface/60 text-left px-2 py-1 text-[10px] font-sans text-app-signal font-semibold border-b border-app-border">
                                                      {tbl.sheetName || `Table ${tIdx + 1}`}
                                                    </caption>
                                                    {tbl.headers && tbl.headers.length > 0 && (
                                                      <thead className="bg-app-surface text-white">
                                                        <tr>
                                                          {tbl.headers.map((h, hIdx) => (
                                                            <th key={hIdx} className="px-2 py-1 border-b border-app-border font-semibold">
                                                              {h}
                                                            </th>
                                                          ))}
                                                        </tr>
                                                      </thead>
                                                    )}
                                                    <tbody>
                                                      {tbl.rows?.map((r, rIdx) => (
                                                        <tr key={rIdx} className="border-b border-app-border/40 hover:bg-app-surface/20">
                                                          {r.map((cell, cellIdx) => (
                                                            <td key={cellIdx} className="px-2 py-1 text-app-text-muted">
                                                              {cell}
                                                            </td>
                                                          ))}
                                                        </tr>
                                                      ))}
                                                    </tbody>
                                                  </table>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION 3: Action Items Table */}
          <div id="action-items-section" data-testid="action-items-section">
            <h2 className="text-base font-bold font-display text-white mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-400" />
              Action Items ({reportData.actionItems.length})
            </h2>

            <Card className="border-app-border overflow-x-auto">
              <table className="w-full text-left text-xs" data-testid="action-items-table">
                <thead className="bg-app-surface border-b border-app-border text-2xs uppercase tracking-wider text-app-text-muted font-semibold">
                  <tr>
                    <th className="px-4 py-3">Content ID</th>
                    <th className="px-4 py-3">Page URL</th>
                    <th className="px-4 py-3">Impact on Ranking</th>
                    <th className="px-4 py-3">Identified Issues</th>
                    <th className="px-4 py-3">How to Improve</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-border">
                  {reportData.actionItems.map((item) => {
                    const isOrphanIssue =
                      item.identifiedIssues.toLowerCase().includes('orphan') ||
                      item.identifiedIssues.startsWith('orphan-');
                    const isContentIssue =
                      item.identifiedIssues.startsWith('pdf-') ||
                      item.identifiedIssues.startsWith('video-') ||
                      item.identifiedIssues.startsWith('image-') ||
                      item.identifiedIssues.startsWith('document-');

                    return (
                      <tr key={item.contentId} className="hover:bg-app-surface/40 transition-colors">
                        <td className="px-4 py-3 font-mono text-[11px] text-app-text-muted">
                          {item.contentId.slice(-6)}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-white truncate max-w-[160px]">
                          {item.pageUrl}
                        </td>
                        <td className="px-4 py-3 text-app-text-muted max-w-[200px]">
                          {item.impactOnRanking}
                        </td>
                        <td className="px-4 py-3 font-medium text-white max-w-[200px]">
                          <div className="flex items-center gap-1.5 mb-1">
                            {isOrphanIssue ? (
                              <Badge variant="danger" data-testid={`type-indicator-${item.contentId}`} className="text-[9px] px-1.5 py-0.2 uppercase font-mono bg-rose-500/20 text-rose-300 border-rose-500/30">
                                Graph Orphan Page
                              </Badge>
                            ) : isContentIssue ? (
                              <Badge variant="info" data-testid={`type-indicator-${item.contentId}`} className="text-[9px] px-1.5 py-0.2 uppercase font-mono">
                                Content
                              </Badge>
                            ) : (
                              <Badge variant="default" data-testid={`type-indicator-${item.contentId}`} className="text-[9px] px-1.5 py-0.2 uppercase font-mono">
                                Page
                              </Badge>
                            )}
                          </div>
                          {item.identifiedIssues}
                        </td>
                        <td className="px-4 py-3 text-app-text-muted max-w-[220px]">
                          {item.howToImprove}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                              item.status === 'approved'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : item.status === 'applied'
                                ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                                : item.status === 'proposed'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                : 'bg-slate-500/10 text-app-text-muted border-app-border'
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {item.status !== 'approved' && item.status !== 'applied' && (
                              <button
                                id={`approve-btn-${item.contentId}`}
                                data-testid={`approve-btn-${item.contentId}`}
                                onClick={() => handleApproveAction(item.contentId)}
                                className="inline-flex items-center gap-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-lg transition-colors font-medium text-[11px]"
                              >
                                <Check className="h-3 w-3" />
                                Approve
                              </button>
                            )}
                            {item.status === 'approved' && (
                              <button
                                id={`reject-btn-${item.contentId}`}
                                data-testid={`reject-btn-${item.contentId}`}
                                onClick={() => handleRejectAction(item.contentId)}
                                className="inline-flex items-center gap-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 px-2.5 py-1 rounded-lg transition-colors font-medium text-[11px]"
                              >
                                <X className="h-3 w-3" />
                                Reset
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>

          {/* SECTION 4: AI Copilot Chat ("Ask about this report") */}
          <div id="chat-section" data-testid="chat-section">
            <h2 className="text-base font-bold font-display text-white mb-3 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-app-signal" />
              Ask About This Report
            </h2>
            {projectId && <ChatPanel projectId={projectId} activeSection={activeSection} />}
          </div>
        </motion.div>
      )}
    </div>
  );
}
