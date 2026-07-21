import { useState, useEffect } from 'react';
import { NavLink, Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import api from '../lib/api';
import { UpgradeBanner } from './UpgradeBanner';
import { pageTransition } from '../lib/motion';

function Icon({ path }: { path: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5 flex-shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

interface Project {
  _id: string;
  name: string;
  domain: string;
}

const STORAGE_KEY = 're_selected_project';

export type NavItemDef = { label: string; to: string | null; icon: any };

type NavGroup =
  | { label: string; items: NavItemDef[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Site Health',
    items: [
      { label: 'Audit / Checklist', to: null, icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
      { label: 'Migration Check', to: null, icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
    ],
  },
  {
    label: 'Content',
    items: [
      { label: 'Content Editor', to: null, icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
    ],
  },
  {
    label: 'Rankings',
    items: [
      { label: 'Keywords', to: null, icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z' },
      { label: 'Keyword Research', to: '/keyword-research', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
    ],
  },
  {
    label: 'Authority',
    items: [
      { label: 'Backlinks', to: null, icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
    ],
  },
  {
    label: 'AI Visibility',
    items: [
      { label: 'AI Visibility', to: null, icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
    ],
  },
  {
    label: 'Competitors',
    items: [
      { label: 'Overview & Gap Analysis', to: null, icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
    ],
  },
];

// ── Standalone route resolver (exported for testing) ─────────────────────
// Every NAV_GROUPS item whose `to` is not a global route must appear here.
const LABEL_ROUTE_MAP: Record<string, string> = {
  'Audit / Checklist': '',
  'Migration Check': '',
  'Keywords': '/keywords',
  'Backlinks': '/backlinks',
  'AI Visibility': '/ai-visibility',
  'Overview & Gap Analysis': '/competitors',
  'Content Editor': '/content-editor',
};

export function resolveNavRoute(
  item: NavItemDef,
  selectedProjectId: string | null,
): string | null {
  if (item.to === '/keyword-research') return '/keyword-research';
  if (!selectedProjectId) return null;
  const suffix = LABEL_ROUTE_MAP[item.label];
  return suffix !== undefined
    ? `/projects/${selectedProjectId}${suffix}`
    : null;
}
// ──────────────────────────────────────────────────────────────────────────

export default function Layout() {
  const { user, logout } = useAuth();
  const { notifications, unreadCount, markRead } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );
  const [bellOpen, setBellOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);

  // Detect project ID from current URL
  useEffect(() => {
    const m = location.pathname.match(/^\/projects\/([a-f0-9]+)/);
    if (m) {
      setSelectedProjectId(m[1]);
      localStorage.setItem(STORAGE_KEY, m[1]);
    }
  }, [location.pathname]);

  // Fetch projects for the switcher
  useEffect(() => {
    api
      .get<Project[]>('/projects')
      .then(({ data }) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const selectedProject = projects.find((p) => p._id === selectedProjectId);

  const handleSwitchProject = (pid: string) => {
    setSelectedProjectId(pid);
    localStorage.setItem(STORAGE_KEY, pid);
    setProjectPickerOpen(false);
    navigate(`/projects/${pid}`);
  };

  const resolveTo = (item: NavItemDef): string | null =>
    resolveNavRoute(item, selectedProjectId);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : 'U';

  const closeMobileSidebar = () => setMobileSidebarOpen(false);

  return (
    <div className="flex h-screen bg-app-base text-app-text font-sans overflow-hidden">
      {/* Mobile sidebar backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={closeMobileSidebar}
          aria-hidden="true"
        />
      )}

      {/* ──────────────────────────────────── SIDEBAR ── */}
      <aside
        className={`flex flex-col border-r border-app-border bg-app-base transition-all duration-300 flex-shrink-0 ${
          sidebarOpen ? 'w-60' : 'w-16'
        } fixed md:static inset-y-0 left-0 z-40 md:z-auto ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Logo + toggle */}
        <div className="h-14 flex items-center px-4 border-b border-app-border flex-shrink-0">
          <button
            onClick={() => { setSidebarOpen((o) => !o); setMobileSidebarOpen(false); }}
            className="mr-3 p-1 rounded hover:bg-app-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70"
            aria-label="Toggle sidebar"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-app-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {sidebarOpen && (
            <span className="text-base font-bold tracking-tight text-app-text">
              RankEngine <span className="text-app-signal">AI</span>
            </span>
          )}
        </div>

        {/* Project switcher */}
        {sidebarOpen && (
          <div className="px-3 pt-3 pb-1 border-b border-app-border">
            <div className="relative">
              <button
                onClick={() => setProjectPickerOpen((o) => !o)}
                className="w-full flex items-center gap-2 bg-app-surface hover:bg-app-surface border border-app-border rounded-lg px-3 py-2 text-xs text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-app-text-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="truncate text-app-text">
                  {selectedProject ? selectedProject.name : 'Select project…'}
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-app-text-muted ml-auto flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {projectPickerOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setProjectPickerOpen(false)} />
                  <div className="absolute left-0 right-0 mt-1 bg-app-surface border border-app-border rounded-lg shadow-xl shadow-black/60 z-20 max-h-48 overflow-y-auto">
                    {projects.length === 0 ? (
                      <p className="px-3 py-2 text-2xs text-app-text-muted">No projects yet</p>
                    ) : (
                      projects.map((p) => (
                        <button
                          key={p._id}
                          onClick={() => handleSwitchProject(p._id)}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-app-surface transition-colors flex items-center gap-2 ${
                            p._id === selectedProjectId ? 'bg-app-signal/10 text-app-signal' : 'text-app-text'
                          }`}
                        >
                          <span className="truncate flex-1">{p.name}</span>
                          <span className="text-2xs text-app-text-muted truncate max-w-[80px]">{p.domain}</span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Nav links — grouped sections */}
        <nav className="flex-1 py-3 overflow-y-auto space-y-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              {sidebarOpen && (
                <p className="px-5 text-2xs font-semibold text-app-text-muted uppercase tracking-widest mb-0.5">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => {
                const to = resolveTo(item);
                const isDisabled = to === null;

                if (isDisabled) {
                  return (
                    <div
                      key={item.label}
                      className="flex items-center gap-3 px-4 py-2 text-sm font-medium text-app-text-muted cursor-not-allowed select-none mx-2 rounded-lg"
                      title={
                        !selectedProjectId
                          ? `${item.label} — select a project first`
                          : `${item.label} — coming soon`
                      }
                    >
                      <Icon path={item.icon} />
                      {sidebarOpen && <span>{item.label}</span>}
                    </div>
                  );
                }

                  return (
                    <NavLink
                      key={item.label}
                      to={to!}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-4 py-2 text-sm font-medium mx-2 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70 ${
                          isActive
                            ? 'bg-app-signal/20 text-app-signal border border-app-signal/30'
                            : 'text-app-text-muted hover:text-app-text hover:bg-app-surface/60'
                        }`
                      }
                    >
                      <Icon path={item.icon} />
                      {sidebarOpen && <span>{item.label}</span>}
                    </NavLink>
                );
              })}
            </div>
          ))}

          {/* Project list (from old nav) */}
          <div>
            {sidebarOpen && (
              <p className="px-5 text-2xs font-semibold text-app-text-muted uppercase tracking-widest mb-0.5">
                General
              </p>
            )}
            <NavLink
              to="/dashboard"
              end
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2 text-sm font-medium mx-2 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70 ${
                  isActive
                    ? 'bg-app-signal/20 text-app-signal border border-app-signal/30'
                    : 'text-app-text-muted hover:text-app-text hover:bg-app-surface/60'
                }`
              }
            >
              <Icon path="M3 7h18M3 12h18M3 17h18" />
              {sidebarOpen && <span>All Projects</span>}
            </NavLink>

            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2 text-sm font-medium mx-2 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70 ${
                  isActive
                    ? 'bg-app-signal/20 text-app-signal border border-app-signal/30'
                    : 'text-app-text-muted hover:text-app-text hover:bg-app-surface/60'
                }`
              }
            >
              <Icon path="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              {sidebarOpen && <span>Settings</span>}
            </NavLink>

            <NavLink
              to="/notifications"
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2 text-sm font-medium mx-2 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70 ${
                  isActive
                    ? 'bg-app-signal/20 text-app-signal border border-app-signal/30'
                    : 'text-app-text-muted hover:text-app-text hover:bg-app-surface/60'
                }`
              }
            >
              <Icon path="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              {sidebarOpen && <span>Notifications</span>}
              {unreadCount > 0 && sidebarOpen && (
                <span className="ml-auto bg-app-signal text-app-text text-[10px] font-bold rounded-full h-4 min-w-4 px-1 flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </NavLink>
          </div>
        </nav>

        {/* Sidebar footer */}
        {sidebarOpen && (
          <div className="px-4 py-3 border-t border-app-border text-[11px] text-app-text-muted space-y-1">
            <Link to="/pricing" className="block hover:text-app-signal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70 rounded">
              Pricing & Plans
            </Link>
            <div>RankEngine AI v1.0</div>
          </div>
        )}
      </aside>

      {/* ──────────────────────────────── MAIN AREA ── */}
      <div className={`flex flex-col flex-1 overflow-hidden ${sidebarOpen ? 'md:ml-0' : 'md:ml-0'} ml-0`}>

        {/* ─────────────── TOP HEADER ─────────────── */}
        <header className="h-14 bg-app-base border-b border-app-border flex items-center justify-between px-4 gap-3 flex-shrink-0">

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="md:hidden p-1.5 rounded hover:bg-app-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70"
            aria-label="Open menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-app-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Right-side actions */}
          <div className="flex items-center gap-3 ml-auto">

          {/* ── Notification Bell ── */}
          <div className="relative">
            <button
              id="notification-bell-btn"
              onClick={() => { setBellOpen((o) => !o); setUserMenuOpen(false); }}
              className="relative p-2 rounded-lg text-app-text-muted hover:text-app-text hover:bg-app-surface transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70"
              aria-label="Notifications"
            >
              <Icon path="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              {unreadCount > 0 && (
                <span
                  id="notification-unread-badge"
                  className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-app-signal text-app-text text-[10px] font-bold flex items-center justify-center leading-none"
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {bellOpen && (
              <div
                id="notification-dropdown"
                className="absolute right-0 mt-2 w-80 bg-app-surface border border-app-border rounded-xl shadow-2xl shadow-black/60 z-50 overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-app-border flex items-center justify-between">
                  <span className="text-sm font-semibold text-app-text">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="text-xs text-app-signal">{unreadCount} unread</span>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="text-app-text-muted text-xs text-center py-8">No notifications yet</p>
                  ) : (
                    notifications.slice(0, 10).map((n) => (
                      <div
                        key={n._id}
                        className={`px-4 py-3 border-b border-app-border/50 flex items-start gap-3 hover:bg-app-surface/40 transition-colors cursor-pointer ${
                          !n.read ? 'bg-app-signal/5' : ''
                        }`}
                        onClick={() => !n.read && markRead(n._id)}
                      >
                        <span
                          className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                            n.read ? 'bg-slate-700' : 'bg-indigo-400'
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs leading-relaxed ${n.read ? 'text-app-text-muted' : 'text-app-text'}`}>
                            {n.message}
                          </p>
                          <p className="text-[10px] text-app-text-muted mt-0.5">
                            {new Date(n.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── User Menu ── */}
          <div className="relative">
            <button
              id="user-menu-btn"
              onClick={() => { setUserMenuOpen((o) => !o); setBellOpen(false); }}
              className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-lg hover:bg-app-surface transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70"
            >
              <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-app-text text-xs font-bold select-none">
                {initials}
              </div>
              {user?.name && (
                <span className="text-sm text-app-text hidden sm:block max-w-28 truncate">
                  {user.name}
                </span>
              )}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 text-app-text-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {userMenuOpen && (
              <div
                id="user-menu-dropdown"
                className="absolute right-0 mt-2 w-48 bg-app-surface border border-app-border rounded-xl shadow-2xl shadow-black/60 z-50 overflow-hidden py-1"
              >
                <div className="px-4 py-2.5 border-b border-app-border">
                  <p className="text-xs font-semibold text-app-text truncate">{user?.name}</p>
                  <p className="text-[11px] text-app-text-muted truncate">{user?.email}</p>
                </div>
                <NavLink
                  to="/settings"
                  onClick={() => setUserMenuOpen(false)}
                  className="w-full text-left px-4 py-2.5 text-sm text-app-text hover:bg-app-surface hover:text-app-text transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-app-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </NavLink>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2.5 text-sm text-app-text hover:bg-app-surface hover:text-app-text transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-app-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Logout
                </button>
              </div>
            )}
          </div>{/* end user menu */}
          </div>{/* end right-side actions */}
        </header>

        {/* ─────────────── UPGRADE BANNER ─────────────── */}
        <UpgradeBanner />

        {/* ─────────────── PAGE CONTENT ─────────────── */}
        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={pageTransition.initial}
              animate={pageTransition.animate}
              exit={pageTransition.exit}
              transition={pageTransition.transition}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
