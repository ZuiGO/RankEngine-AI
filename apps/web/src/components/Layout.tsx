import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../lib/api';
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

interface NotificationItem {
  _id: string;
  message: string;
  read: boolean;
  createdAt: string;
}

const STORAGE_KEY = 're_selected_project';

export interface NavItemDef {
  label: string;
  to: string | null;
  icon: string;
}

export const NAV_GROUPS: { label: string; items: NavItemDef[] }[] = [
  { label: 'Site Health', items: [
    { label: 'Audit / Checklist', to: null as string | null, icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
    { label: 'Core Web Vitals', to: null as string | null, icon: 'M13 10V3L4 14h7v7l9-11h-7zM9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  ]},
  { label: 'Content', items: [
    { label: 'Content Editor', to: null as string | null, icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' },
    { label: 'AI Writer', to: null as string | null, icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
  ]},
  { label: 'Rankings', items: [
    { label: 'Keywords', to: null as string | null, icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z' },
    { label: 'Keyword Research', to: '/keyword-research' as string | null, icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
    { label: 'Keyword Clustering', to: null as string | null, icon: 'M4 7h16M4 12h16M4 17h16' },
  ]},
  { label: 'Authority', items: [{ label: 'Backlinks', to: null as string | null, icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' }] },
  { label: 'AI Visibility', items: [{ label: 'AI Visibility', to: null as string | null, icon: 'M13 10V3L4 14h7v7l9-11h-7z' }] },
  { label: 'Competitors', items: [{ label: 'Overview & Gap Analysis', to: null as string | null, icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' }] },
  { label: 'Optimization', items: [
    { label: 'Internal Linking', to: null as string | null, icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
    { label: 'AI Chat', to: null as string | null, icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  ]},
  { label: 'Reports', items: [
    { label: 'Content Performance', to: null as string | null, icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { label: 'Before / After', to: null as string | null, icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4' },
  ]},
  { label: 'Settings', items: [
    { label: 'Project Settings', to: null as string | null, icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  ]},
];

const LABEL_ROUTE_MAP: Record<string, string> = {
  'Audit / Checklist': '',
  'Migration Check': '',
  'Core Web Vitals': '/cwv',
  'Content Editor': '/content-editor',
  'AI Writer': '/content-writer',
  'Keywords': '/keywords',
  'Keyword Clustering': '/keyword-clustering',
  'Backlinks': '/backlinks',
  'AI Visibility': '/ai-visibility',
  'Overview & Gap Analysis': '/competitors',
  'Internal Linking': '/internal-links',
  'AI Chat': '/chat',
  'Content Performance': '/reports/content-performance',
  'Before / After': '/reports/comparison',
  'Project Settings': '/settings',
};

export function resolveNavRoute(
  item: { label: string; to: string | null; icon?: string },
  selectedProjectId: string | null,
): string | null {
  if (item.to === '/keyword-research') return '/keyword-research';
  if (!selectedProjectId) return null;
  const suffix = LABEL_ROUTE_MAP[item.label];
  return suffix !== undefined ? `/projects/${selectedProjectId}${suffix}` : null;
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );
  const [bellOpen, setBellOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const m = location.pathname.match(/^\/projects\/([a-f0-9]+)/);
    if (m) {
      setSelectedProjectId(m[1]);
      localStorage.setItem(STORAGE_KEY, m[1]);
    }
  }, [location.pathname]);

  useEffect(() => {
    api.get<Project[]>('/projects')
      .then(({ data }) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const fetchNotifications = () => {
      api.get('/notifications')
        .then(({ data }) => {
          if (data.notifications) setNotifications(data.notifications);
          if (data.unreadCount !== undefined) setUnreadCount(data.unreadCount);
        })
        .catch(() => {});
    };
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, []);

  const markRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) => prev.map((n) => (n._id === id ? { ...n, read: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {}
  };

  const selectedProject = projects.find((p) => p._id === selectedProjectId);

  const handleSwitchProject = (pid: string) => {
    setSelectedProjectId(pid);
    localStorage.setItem(STORAGE_KEY, pid);
    setProjectPickerOpen(false);
    navigate(`/projects/${pid}`);
  };

  const closeMobileSidebar = () => setMobileSidebarOpen(false);

  return (
    <div className="flex h-screen bg-app-base text-app-text font-sans overflow-hidden">
      {mobileSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={closeMobileSidebar} aria-hidden="true" />
      )}

      <aside
        className={`flex flex-col border-r border-app-border bg-app-base transition-all duration-300 flex-shrink-0 ${
          sidebarOpen ? 'w-60' : 'w-16'
        } fixed md:static inset-y-0 left-0 z-40 md:z-auto ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="h-14 flex items-center px-4 border-b border-app-border flex-shrink-0">
          <button
            onClick={() => { setSidebarOpen((o) => !o); setMobileSidebarOpen(false); }}
            className="mr-3 p-1 rounded hover:bg-app-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70"
            aria-label="Toggle sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-app-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {sidebarOpen && (
            <span className="text-base font-bold tracking-tight text-app-text">
              RankEngine <span className="text-app-signal">AI</span>
            </span>
          )}
        </div>

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
                <span className="truncate text-app-text">{selectedProject ? selectedProject.name : 'Select project\u2026'}</span>
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

        <nav className="flex-1 py-3 overflow-y-auto space-y-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              {sidebarOpen && (
                <p className="px-5 text-2xs font-semibold text-app-text-muted uppercase tracking-widest mb-0.5">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => {
                const to = resolveNavRoute(item, selectedProjectId);
                const isDisabled = to === null;

                if (isDisabled) {
                  return (
                    <div
                      key={item.label}
                      className="flex items-center gap-3 px-4 py-2 text-sm font-medium text-app-text-muted cursor-not-allowed select-none mx-2 rounded-lg"
                      title={!selectedProjectId ? `${item.label} — select a project first` : `${item.label} — coming soon`}
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

          <div>
            {sidebarOpen && (
              <p className="px-5 text-2xs font-semibold text-app-text-muted uppercase tracking-widest mb-0.5">General</p>
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

        {sidebarOpen && (
          <div className="px-4 py-3 border-t border-app-border text-[11px] text-app-text-muted space-y-1">
            <div>RankEngine AI v1.0</div>
          </div>
        )}
      </aside>

      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="h-14 bg-app-base border-b border-app-border flex items-center justify-between px-4 gap-3 flex-shrink-0">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="md:hidden p-1.5 rounded hover:bg-app-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70"
            aria-label="Open menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-app-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="flex items-center gap-3 ml-auto">
            <div className="relative">
              <button
                id="notification-bell-btn"
                onClick={() => setBellOpen((o) => !o)}
                className="relative p-2 rounded-lg text-app-text-muted hover:text-app-text hover:bg-app-surface transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70"
                aria-label="Notifications"
              >
                <Icon path="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-app-signal text-app-text text-[10px] font-bold flex items-center justify-center leading-none">
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
                    {unreadCount > 0 && <span className="text-xs text-app-signal">{unreadCount} unread</span>}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="text-app-text-muted text-xs text-center py-8">No notifications yet</p>
                    ) : (
                      notifications.slice(0, 10).map((n) => (
                        <div
                          key={n._id}
                          className={`px-4 py-3 border-b border-app-border/50 flex items-start gap-3 hover:bg-app-surface/40 transition-colors cursor-pointer ${!n.read ? 'bg-app-signal/5' : ''}`}
                          onClick={() => !n.read && markRead(n._id)}
                        >
                          <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${n.read ? 'bg-slate-700' : 'bg-indigo-400'}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs leading-relaxed ${n.read ? 'text-app-text-muted' : 'text-app-text'}`}>{n.message}</p>
                            <p className="text-[10px] text-app-text-muted mt-0.5">{new Date(n.createdAt).toLocaleString()}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

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
