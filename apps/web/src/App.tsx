import { useState, useEffect } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  useParams,
  useNavigate,
  Link,
  Navigate,
} from 'react-router-dom';
import { Pencil } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import '@uiw/react-markdown-preview/markdown.css';

import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import SettingsPage from './pages/SettingsPage';
import OnboardingPage from './pages/OnboardingPage';

const API_BASE = 'http://localhost:3000/api';

// =========================================================================
// TYPES
// =========================================================================
interface Project {
  _id: string;
  name: string;
  domain: string;
  stagingDomain?: string;
}

interface GradeBreakdown {
  entityCoverage: number;
  structureScore: number;
  readability: number;
}



interface H2Analysis {
  heading: string;
  wordCount: number;
  isValid: boolean;
  warning?: string;
}

// =========================================================================
// HELPERS
// =========================================================================
const analyzeH2Headings = (text: string): H2Analysis[] => {
  const lines = text.split('\n');
  const results: H2Analysis[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Match lines starting with markdown heading '## ' or HTML heading '<h2>'
    const isH2 = line.startsWith('## ') || /^<h2>/i.test(line);
    if (isH2) {
      const headingText = line
        .replace(/^##\s+/, '')
        .replace(/<[^>]*>/g, '')
        .trim();

      // Look ahead for the next non-empty paragraph text block
      let nextParagraphText = '';
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (nextLine.length > 0) {
          // If we reach another heading, stop
          if (nextLine.startsWith('#') || /^<h[1-6]/i.test(nextLine)) {
            break;
          }
          nextParagraphText = nextLine;
          break;
        }
      }

      const words = nextParagraphText.split(/\s+/).filter((w) => w.length > 0);
      const wordCount = nextParagraphText ? words.length : 0;
      // CON-03 condition: must be 40 to 80 words
      const isValid = wordCount >= 40 && wordCount <= 80;

      results.push({
        heading: headingText,
        wordCount,
        isValid,
        warning: !isValid
          ? 'Add a 40–80 word direct answer here for AI Overview eligibility'
          : undefined,
      });
    }
  }

  return results;
};

// =========================================================================
// AUTH ROUTE GUARD (legacy — kept for reference; new code uses ProtectedRoute component)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function LegacyRequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('re_token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

// =========================================================================
// MAIN ROUTER SHELL
// =========================================================================
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <NotificationProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            {/* Protected routes — wrapped in Layout (sidebar + header) */}
            <Route element={<ProtectedRoute />}>
              {/* Onboarding is full-screen, no sidebar */}
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route element={<Layout />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/projects/:id/content-editor" element={<ContentEditor />} />
                <Route path="/projects/:id/keywords" element={<KeywordTracker />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </NotificationProvider>
      </BrowserRouter>
    </AuthProvider>
  );
}

// =========================================================================
// LOGIN & REGISTRATION CARD
// =========================================================================
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Login({ onAuth }: { onAuth: (token: string) => void }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState('agency_owner');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const url = isRegister ? `${API_BASE}/auth/register` : `${API_BASE}/auth/login`;
    const body = isRegister
      ? { email, password, companyName, role }
      : { email, password };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }
      localStorage.setItem('re_token', data.token);
      onAuth(data.token);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-32 h-32 bg-indigo-600/10 rounded-full blur-2xl pointer-events-none" />
        <h2 className="text-2xl font-bold text-white tracking-tight mb-2">
          {isRegister ? 'Create your Account' : 'Welcome Back'}
        </h2>
        <p className="text-slate-400 text-sm mb-6">
          {isRegister ? 'Join RankEngine AI optimization team' : 'Log in to optimize content ranks'}
        </p>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Email Address</label>
            <input
              type="email"
              required
              className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-600 outline-none transition-all"
              placeholder="e.g. dev@rankengine.ai"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Password</label>
            <input
              type="password"
              required
              className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-600 outline-none transition-all"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {isRegister && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Company Name</label>
                <input
                  type="text"
                  required
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-600 outline-none transition-all"
                  placeholder="e.g. RankEngine Ltd"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1.5">Team Role</label>
                <select
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3.5 py-2 text-sm text-white outline-none transition-all"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="agency_owner">Agency Owner</option>
                  <option value="marketer">Marketer</option>
                  <option value="developer">Developer</option>
                </select>
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors mt-2"
          >
            {loading ? 'Processing...' : isRegister ? 'Register' : 'Login'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsRegister(!isRegister)}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
          >
            {isRegister ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// DASHBOARD PROJECT MANAGER
// =========================================================================
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [stagingDomain, setStagingDomain] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const token = localStorage.getItem('re_token');

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${API_BASE}/projects`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setProjects(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCreating(true);

    try {
      const res = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, domain, stagingDomain: stagingDomain || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Project creation failed');
      }
      setName('');
      setDomain('');
      setStagingDomain('');
      fetchProjects();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Create Project Form */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl h-fit">
          <h3 className="text-lg font-bold text-white mb-4">Create New Project</h3>
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-4">
              {error}
            </div>
          )}
          <form onSubmit={handleCreateProject} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Project Name</label>
              <input
                type="text"
                required
                className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-700 outline-none transition-all"
                placeholder="e.g. My Blog"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">Live Domain</label>
              <input
                type="text"
                required
                className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-700 outline-none transition-all"
                placeholder="e.g. https://myblog.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Staging Domain (Optional)
              </label>
              <input
                type="text"
                className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-700 outline-none transition-all"
                placeholder="e.g. https://staging.myblog.com"
                value={stagingDomain}
                onChange={(e) => setStagingDomain(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm py-2 rounded-lg transition-colors mt-2"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </form>
        </div>

        {/* Right Column: Projects List */}
        <div className="lg:col-span-2">
          <h3 className="text-xl font-bold text-white mb-6">Your Optimization Projects</h3>
          {loading ? (
            <div className="text-slate-400 text-sm">Loading projects...</div>
          ) : projects.length === 0 ? (
            <div className="bg-slate-900/50 border border-slate-900 border-dashed rounded-2xl p-12 text-center">
              <span className="text-slate-500 text-sm block mb-1">No projects registered yet</span>
              <span className="text-slate-600 text-xs block">Use the left panel to register your first web domain.</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projects.map((p) => (
                <div
                  key={p._id}
                  className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 shadow-lg transition-all flex flex-col justify-between"
                >
                  <div>
                    <h4 className="font-bold text-white text-base mb-1">{p.name}</h4>
                    <span className="text-xs text-indigo-400 font-mono block mb-1">{p.domain}</span>
                    {p.stagingDomain && (
                      <span className="text-xs text-slate-500 font-mono block">Staging: {p.stagingDomain}</span>
                    )}
                  </div>
                  <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between space-x-2">
                    <Link
                      to={`/projects/${p._id}/content-editor`}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-3.5 py-2 rounded-lg transition-colors shadow-md shadow-indigo-500/10 flex-1 text-center"
                    >
                      Content Editor
                    </Link>
                    <Link
                      to={`/projects/${p._id}/keywords`}
                      className="bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white font-semibold text-xs px-3.5 py-2 rounded-lg transition-colors flex-1 text-center"
                    >
                      Keyword Tracker
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// TWO-PANE CONTENT OPTIMIZATION EDITOR
// =========================================================================
export function ContentEditor() {

  const token = localStorage.getItem('re_token');

  // Input states
  const [text, setText] = useState('## AI Overview Check\n\nThis is the first paragraph. We want to write at least 40 words here to verify direct answer opportunities. RankEngine automatically analyses content headings to test eligibility markers. Write a complete description containing enough syllables to test readability too.\n\n## Syllable check\n\nAnother paragraph follows this heading to check structure scores.');
  const [targetKeyword, setTargetKeyword] = useState('rankengine');
  
  // Cache of SerpAnalysis checklist
  const [sharedEntities, setSharedEntities] = useState<string[]>([]);
  const [sharedSubtopics, setSharedSubtopics] = useState<string[]>([]);
  const [serpLoading, setSerpLoading] = useState(false);
  const [serpError, setSerpError] = useState('');

  // Local validation lists
  const [h2Analyses, setH2Analyses] = useState<H2Analysis[]>([]);

  // Grader API score states
  const [score, setScore] = useState(0);
  const [breakdown, setBreakdown] = useState<GradeBreakdown>({
    entityCoverage: 0,
    structureScore: 0,
    readability: 0,
  });
  const [gradingLoading, setGradingLoading] = useState(false);

  // Debounced API fetch trigger
  useEffect(() => {
    // 1. Compute H2 warnings locally instantly for responsive UI
    const analyses = analyzeH2Headings(text);
    setH2Analyses(analyses);

    // 2. Debounce grade endpoint fetches by 300ms
    const timer = setTimeout(() => {
      fetchGraderResults();
    }, 300);

    return () => clearTimeout(timer);
  }, [text, targetKeyword, sharedEntities]);

  const fetchGraderResults = async () => {
    setGradingLoading(true);
    try {
      const res = await fetch(`${API_BASE}/content/grade`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          targetKeyword,
          sharedEntities,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setScore(data.score);
        setBreakdown(data.breakdown);
      }
    } catch (err) {
      console.error('[Grader Fetch Error]:', err);
    } finally {
      setGradingLoading(false);
    }
  };

  const runSerpAnalysis = async () => {
    if (!targetKeyword.trim()) {
      setSerpError('Keyword parameter is required');
      return;
    }
    setSerpError('');
    setSerpLoading(true);
    try {
      const res = await fetch(`${API_BASE}/content/serp-analysis`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keyword: targetKeyword }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'SERP analysis failed');
      }
      setSharedEntities(data.sharedEntities || []);
      setSharedSubtopics(data.sharedSubtopics || []);
    } catch (err: any) {
      setSerpError(err.message);
    } finally {
      setSerpLoading(false);
    }
  };

  // Color Indicator helper
  const getIndicatorColor = (val: number) => {
    if (val >= 80) return 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20';
    if (val >= 50) return 'text-amber-400 bg-amber-500/10 border border-amber-500/20';
    return 'text-rose-500 bg-rose-500/10 border border-rose-500/20';
  };

  const getScoreCircleColor = (val: number) => {
    if (val >= 80) return 'stroke-emerald-400';
    if (val >= 50) return 'stroke-amber-400';
    return 'stroke-rose-500';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Back link bar */}
      <div className="flex items-center justify-between mb-6">
        <Link
          to="/"
          className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center space-x-1 transition-colors"
        >
          <span>← Back to Dashboard</span>
        </Link>
        <span className="text-slate-500 text-xs">Real-Time SEO Editor</span>
      </div>

      {/* Inputs Header Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-6 flex flex-col md:flex-row md:items-center space-y-4 md:space-y-0 md:space-x-4 shadow-lg">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-slate-400 mb-1.5">Target Keyword</label>
          <input
            type="text"
            className="w-full bg-slate-950 border border-slate-850 focus:border-indigo-500 rounded-lg px-3.5 py-2 text-sm text-white placeholder-slate-700 outline-none transition-all font-semibold"
            placeholder="e.g. rankengine optimization"
            value={targetKeyword}
            onChange={(e) => setTargetKeyword(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={runSerpAnalysis}
            disabled={serpLoading}
            className="w-full md:w-auto bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-indigo-400 hover:text-indigo-300 font-bold text-sm px-6 py-2 rounded-lg transition-all flex items-center justify-center space-x-2"
          >
            {serpLoading ? 'Analyzing...' : 'Run SERP Analysis'}
          </button>
        </div>
      </div>

      {serpError && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-6">
          {serpError}
        </div>
      )}

      {/* TWO PANE LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT PANE: MD/PLAIN-TEXT EDITOR & CON-03 WARNINGS */}
        <div className="lg:col-span-7 space-y-6">
          {/* Editor block wrapper */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <h3 className="text-sm font-bold text-white mb-3">Document Editor</h3>
            <div data-color-mode="dark">
              <MDEditor
                value={text}
                onChange={(val) => setText(val || '')}
                height={400}
                preview="edit"
              />
            </div>
          </div>

          {/* H2 Warning Check (CON-03) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <h3 className="text-sm font-bold text-white mb-4">AI Overview H2 Direct-Answer Validation</h3>
            {h2Analyses.length === 0 ? (
              <p className="text-slate-500 text-xs">No H2 headings detected in document editor yet. Add "## Heading" to trigger validations.</p>
            ) : (
              <div className="space-y-3">
                {h2Analyses.map((analysis, idx) => (
                  <div
                    key={idx}
                    className={`p-3.5 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                      analysis.isValid
                        ? 'bg-emerald-500/5 border-emerald-500/15 text-emerald-400'
                        : 'bg-rose-500/5 border-rose-500/15 text-rose-400'
                    }`}
                  >
                    <div>
                      <h4 className="font-bold text-sm text-slate-200">
                        H2: <span className="italic">"{analysis.heading}"</span>
                      </h4>
                      <p className="text-xs text-slate-400 mt-1">
                        {analysis.isValid ? (
                          <span className="text-emerald-400 font-semibold">✓ Perfect direct-answer paragraph length!</span>
                        ) : (
                          <span>{analysis.warning}</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-950 border border-slate-800 font-mono text-slate-300">
                        {analysis.wordCount} words
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANE: SCORE BREAKDOWN & CHECKLISTS */}
        <div className="lg:col-span-5 space-y-6">
          {/* Score breakdown card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl text-center relative overflow-hidden">
            <h3 className="text-sm font-bold text-white mb-6 text-left flex items-center justify-between">
              <span>SEO Content Score</span>
              {gradingLoading && <span className="text-2xs text-indigo-400 font-normal">Analyzing...</span>}
            </h3>

            {text.trim().length < 20 && !gradingLoading ? (
              <div className="py-8">
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-slate-800 text-indigo-400 mb-4">
                  <Pencil className="h-6 w-6" />
                </div>
                <p className="text-sm text-slate-400 max-w-xs mx-auto">
                  Start writing in the editor to see your SEO score. We'll analyze entity coverage, heading structure, and readability against your target keyword in real time.
                </p>
              </div>
            ) : (
              <>
                {/* Radial score gauge */}
                <div className="relative w-40 h-40 mx-auto flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle
                      className="stroke-slate-800"
                      strokeWidth="8"
                      fill="transparent"
                      r="38"
                      cx="50"
                      cy="50"
                    />
                    <circle
                      className={`transition-all duration-500 ease-out ${getScoreCircleColor(score)}`}
                      strokeWidth="8"
                      strokeDasharray={`${2 * Math.PI * 38}`}
                      strokeDashoffset={`${2 * Math.PI * 38 * (1 - score / 100)}`}
                      strokeLinecap="round"
                      fill="transparent"
                      r="38"
                      cx="50"
                      cy="50"
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center">
                    <span className="text-4xl font-extrabold text-white tracking-tight">{score}</span>
                    <span className="text-2xs text-slate-400 uppercase font-semibold">Grade</span>
                  </div>
                </div>

                {/* Score Breakdown Bars */}
                <div className="space-y-4 mt-8 text-left">
                  <div>
                    <div className="flex justify-between text-xs font-bold text-slate-300 mb-1">
                      <span>Entity Coverage</span>
                      <span className={`px-2 py-0.5 rounded text-2xs font-mono font-bold ${getIndicatorColor(breakdown.entityCoverage)}`}>
                        {breakdown.entityCoverage}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-850">
                      <div
                        className={`h-full transition-all duration-300 ${
                          breakdown.entityCoverage >= 80 ? 'bg-emerald-400' : breakdown.entityCoverage >= 50 ? 'bg-amber-400' : 'bg-rose-500'
                        }`}
                        style={{ width: `${breakdown.entityCoverage}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-bold text-slate-300 mb-1">
                      <span>Structure Score</span>
                      <span className={`px-2 py-0.5 rounded text-2xs font-mono font-bold ${getIndicatorColor(breakdown.structureScore)}`}>
                        {breakdown.structureScore}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-850">
                      <div
                        className={`h-full transition-all duration-300 ${
                          breakdown.structureScore >= 80 ? 'bg-emerald-400' : breakdown.structureScore >= 50 ? 'bg-amber-400' : 'bg-rose-500'
                        }`}
                        style={{ width: `${breakdown.structureScore}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-bold text-slate-300 mb-1">
                      <span>Readability Ease</span>
                      <span className={`px-2 py-0.5 rounded text-2xs font-mono font-bold ${getIndicatorColor(breakdown.readability)}`}>
                        {breakdown.readability}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-850">
                      <div
                        className={`h-full transition-all duration-300 ${
                          breakdown.readability >= 80 ? 'bg-emerald-400' : breakdown.readability >= 50 ? 'bg-amber-400' : 'bg-rose-500'
                        }`}
                        style={{ width: `${breakdown.readability}%` }}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Checklist helpers */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
            <h3 className="text-sm font-bold text-white mb-4">Competitor SEO Checklist</h3>
            {sharedEntities.length === 0 && sharedSubtopics.length === 0 ? (
              <p className="text-slate-500 text-xs">Run SERP Analysis to populate competitor target checklists.</p>
            ) : (
              <div className="space-y-6">
                {/* Entities Checklist */}
                {sharedEntities.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-2.5">
                      Target Entities
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {sharedEntities.map((ent, idx) => {
                        const isFound = text.toLowerCase().includes(ent.toLowerCase());
                        return (
                          <div
                            key={idx}
                            className={`flex items-center space-x-2 text-xs p-2 rounded-lg border ${
                              isFound
                                ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400 line-through'
                                : 'bg-slate-950 border-slate-850 text-slate-400'
                            }`}
                          >
                            <span>{isFound ? '✓' : '○'}</span>
                            <span className="truncate">{ent}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Subtopics Checklist */}
                {sharedSubtopics.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-2.5">
                      Recommended Subtopics
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {sharedSubtopics.map((topic, idx) => {
                        const isFound = text.toLowerCase().includes(topic.toLowerCase());
                        return (
                          <div
                            key={idx}
                            className={`flex items-center space-x-2 text-xs p-2 rounded-lg border ${
                              isFound
                                ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400 line-through'
                                : 'bg-slate-950 border-slate-850 text-slate-400'
                            }`}
                          >
                            <span>{isFound ? '✓' : '○'}</span>
                            <span className="truncate">{topic}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// KEYWORD TRACKING DASHBOARD & CHART
// =========================================================================
interface TrackedKeywordData {
  _id: string;
  keyword: string;
  targetUrl: string;
  competitorDomains: string[];
  currentPosition: number;
  aioPresence: boolean;
  trend: 'up' | 'down' | 'stable';
  history7Days: { position: number; date: string }[];
}

interface HistoricalSnap {
  position: number;
  aioPresence: boolean;
  date: string;
}

export function KeywordTracker() {
  const { id } = useParams();
  const token = localStorage.getItem('re_token');

  const [keywords, setKeywords] = useState<TrackedKeywordData[]>([]);
  const [keyword, setKeyword] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [competitors, setCompetitors] = useState('');

  const [selectedKeywordId, setSelectedKeywordId] = useState<string | null>(null);
  const [selectedKeywordName, setSelectedKeywordName] = useState<string>('');
  const [history, setHistory] = useState<HistoricalSnap[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Suggested keywords state
  const [suggestedKeywords, setSuggestedKeywords] = useState<{ keyword: string; source: string }[]>([]);
  const [trackingKeyword, setTrackingKeyword] = useState<string | null>(null);

  const fetchSuggestedKeywords = async () => {
    try {
      const res = await fetch(`${API_BASE}/projects/${id}/suggested-keywords`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) setSuggestedKeywords(data);
    } catch {
      // silently ignore
    }
  };

  const handleTrackSuggested = async (kw: string) => {
    setTrackingKeyword(kw);
    try {
      const projectRes = await fetch(`${API_BASE}/projects/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const project = await projectRes.json();
      const homepageUrl = project.domain?.startsWith('http') ? project.domain : `https://${project.domain}`;

      const res = await fetch(`${API_BASE}/projects/${id}/keywords`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keyword: kw, targetUrl: homepageUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to track keyword');
      setSuccess(`Now tracking "${kw}"!`);
      fetchKeywords();
      fetchSuggestedKeywords();
    } catch {
      // silently ignore
    } finally {
      setTrackingKeyword(null);
    }
  };

  const fetchKeywords = async () => {
    try {
      const res = await fetch(`${API_BASE}/projects/${id}/keywords`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setKeywords(data);
        if (data.length > 0 && !selectedKeywordId) {
          setSelectedKeywordId(data[0]._id);
          setSelectedKeywordName(data[0].keyword);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async (keywordId: string) => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`${API_BASE}/projects/${id}/keywords/${keywordId}/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setHistory(data.history || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    fetchKeywords();
    fetchSuggestedKeywords();
  }, [id]);

  useEffect(() => {
    if (selectedKeywordId) {
      fetchHistory(selectedKeywordId);
    }
  }, [selectedKeywordId]);

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);

    const competitorList = competitors
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    try {
      const res = await fetch(`${API_BASE}/projects/${id}/keywords`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          keyword,
          targetUrl,
          competitorDomains: competitorList,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to track keyword');
      }
      setKeyword('');
      setTargetUrl('');
      setCompetitors('');
      setSuccess(`Successfully tracking "${data.keyword}"!`);
      fetchKeywords();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const getPositionText = (pos: number) => {
    return pos === 101 ? 'Unranked' : `#${pos}`;
  };

  const getTrendIcon = (trend: 'up' | 'down' | 'stable') => {
    if (trend === 'up') return <span className="text-emerald-400 font-bold">↑ Up</span>;
    if (trend === 'down') return <span className="text-rose-500 font-bold">↓ Down</span>;
    return <span className="text-slate-500">→ Stable</span>;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Back link */}
      <div className="flex items-center justify-between mb-6">
        <Link
          to="/"
          className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold flex items-center space-x-1 transition-colors"
        >
          <span>← Back to Dashboard</span>
        </Link>
        <span className="text-slate-500 text-xs">Keyword Rank Monitor</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left column: Add Keyword & List Keywords */}
        <div className="lg:col-span-7 space-y-6">
          {/* Add Keyword Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <h3 className="text-sm font-bold text-white mb-4">Track New Keyword</h3>
            {error && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-4">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs p-3 rounded-lg mb-4">
                {success}
              </div>
            )}
            <form onSubmit={handleAddKeyword} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <div>
                <label className="block text-2xs font-semibold text-slate-400 mb-1">Keyword</label>
                <input
                  type="text"
                  required
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs px-3 py-1.5 text-white placeholder-slate-700 outline-none transition-all font-semibold"
                  placeholder="e.g. best seo tools"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-2xs font-semibold text-slate-400 mb-1">Target Page URL</label>
                <input
                  type="url"
                  required
                  className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs px-3 py-1.5 text-white placeholder-slate-700 outline-none transition-all font-semibold"
                  placeholder="e.g. https://site.com/blog"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                />
              </div>
              <div className="flex space-x-2">
                <div className="flex-1">
                  <label className="block text-2xs font-semibold text-slate-400 mb-1">Competitors (CSV)</label>
                  <input
                    type="text"
                    className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs px-3 py-1.5 text-white placeholder-slate-700 outline-none transition-all"
                    placeholder="comp1.com, comp2.com"
                    value={competitors}
                    onChange={(e) => setCompetitors(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-colors h-[32px] mt-auto cursor-pointer"
                >
                  Track
                </button>
              </div>
            </form>
          </div>

          {/* Suggested Keywords */}
          {suggestedKeywords.length > 0 && (
            <div className="bg-slate-900 border border-indigo-800/30 rounded-2xl p-5 shadow-xl">
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Suggested for you
              </h3>
              <div className="flex flex-wrap gap-2">
                {suggestedKeywords.map((sk, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs"
                  >
                    <span className="text-slate-200 font-medium">{sk.keyword}</span>
                    <button
                      onClick={() => handleTrackSuggested(sk.keyword)}
                      disabled={trackingKeyword === sk.keyword}
                      className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] font-semibold px-2 py-1 rounded-md transition-colors"
                    >
                      {trackingKeyword === sk.keyword ? 'Adding…' : 'Track'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Keywords List Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl overflow-hidden">
            <h3 className="text-sm font-bold text-white mb-4">Tracked Search Keywords</h3>
            {loading ? (
              <p className="text-slate-500 text-xs">Loading tracked keywords...</p>
            ) : keywords.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-slate-400 text-sm mb-2">No keywords tracked yet</p>
                <p className="text-slate-500 text-xs max-w-sm mx-auto">
                  Add keywords above to monitor your daily ranking positions. You can also check the <span className="text-indigo-400">Suggested for you</span> section — these are terms pulled from your latest audit that your pages already mention.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950/80 text-slate-400 uppercase font-semibold text-2xs border-b border-slate-850">
                    <tr>
                      <th className="p-3">Keyword</th>
                      <th className="p-3">Position</th>
                      <th className="p-3">7-Day Trend</th>
                      <th className="p-3">AI Overview</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {keywords.map((kw) => (
                      <tr
                        key={kw._id}
                        className={`hover:bg-slate-850/40 transition-colors cursor-pointer ${
                          selectedKeywordId === kw._id ? 'bg-indigo-600/5 text-white font-bold' : ''
                        }`}
                        onClick={() => {
                          setSelectedKeywordId(kw._id);
                          setSelectedKeywordName(kw.keyword);
                        }}
                      >
                        <td className="p-3 font-semibold">{kw.keyword}</td>
                        <td className="p-3 font-mono">{getPositionText(kw.currentPosition)}</td>
                        <td className="p-3">{getTrendIcon(kw.trend)}</td>
                        <td className="p-3">
                          {kw.aioPresence ? (
                            <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-2xs px-2 py-0.5 rounded-full font-semibold animate-pulse">
                              In AI Overview
                            </span>
                          ) : (
                            <span className="bg-slate-950 border border-slate-850 text-slate-500 text-2xs px-2 py-0.5 rounded-full">
                              No AIO Links
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            className="text-xs text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedKeywordId(kw._id);
                              setSelectedKeywordName(kw.keyword);
                            }}
                          >
                            Chart History
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right column: 30-Day Line Chart using Recharts */}
        <div className="lg:col-span-5">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative min-h-[400px]">
            <h3 className="text-sm font-bold text-white mb-6">
              30-Day Ranking Chart {selectedKeywordName && `: "${selectedKeywordName}"`}
            </h3>

            {loadingHistory ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 rounded-2xl">
                <span className="text-slate-400 text-xs">Loading chart snapshots...</span>
              </div>
            ) : !selectedKeywordId ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-slate-500 text-xs">Select a keyword to view rank history</span>
              </div>
            ) : history.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-slate-500 text-xs">No historical snaps found for this keyword yet.</span>
              </div>
            ) : (
              <div className="h-64 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="date"
                      stroke="#64748b"
                      tickFormatter={(d) => d.slice(5)}
                      style={{ fontSize: '10px' }}
                    />
                    <YAxis
                      reversed
                      domain={[1, 101]}
                      stroke="#64748b"
                      tickFormatter={(r) => (r === 101 ? 'UR' : r)}
                      style={{ fontSize: '10px' }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155' }}
                      labelStyle={{ color: '#94a3b8', fontWeight: 'bold', fontSize: '11px' }}
                      itemStyle={{ color: '#fff', fontSize: '11px' }}
                      formatter={(value: any, _name: any, item: any) => {
                        const valNum = Number(value);
                        const label = valNum === 101 ? 'Unranked' : `#${valNum}`;
                        const suffix = item?.payload?.aioPresence ? ' (AI Overview)' : '';
                        return [`${label}${suffix}`, 'Rank Position'] as any;
                      }}
                    />
                    <Line
                      name="Rank Position"
                      type="monotone"
                      dataKey="position"
                      stroke="#6366f1"
                      strokeWidth={2.5}
                      dot={{ r: 4, stroke: '#818cf8', strokeWidth: 1 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <div className="flex justify-between items-center text-2xs text-slate-500 mt-4 px-2">
                  <span>Note: Y-axis is inverted (lower numbers = higher rank).</span>
                  <span>UR = Unranked (101)</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
