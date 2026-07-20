import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';

// ── Icon helpers (inline SVG to avoid an icon-lib dep) ─────────────────────
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

const NAV_ITEMS = [
  {
    label: 'Projects',
    to: '/dashboard',
    icon: 'M3 7h18M3 12h18M3 17h18',
  },
  {
    label: 'Content Editor',
    to: null, // context-sensitive — no global route
    icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  },
  {
    label: 'Keyword Tracking',
    to: null, // context-sensitive
    icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z',
  },
  {
    label: 'Notifications',
    to: '/notifications',
    icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { notifications, unreadCount, markRead } = useNotifications();
  const navigate = useNavigate();

  const [bellOpen, setBellOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* ──────────────────────────────────── SIDEBAR ── */}
      <aside
        className={`flex flex-col border-r border-slate-900 bg-slate-950 transition-all duration-300 ${
          sidebarOpen ? 'w-60' : 'w-16'
        }`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-slate-900 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            className="mr-3 p-1 rounded hover:bg-slate-800 transition-colors"
            aria-label="Toggle sidebar"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          {sidebarOpen && (
            <span className="text-base font-bold tracking-tight text-white">
              RankEngine <span className="text-indigo-400">AI</span>
            </span>
          )}
        </div>

        {/* Nav Links */}
        <nav className="flex-1 py-4 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isDisabled = item.to === null;
            const baseClasses =
              'flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-lg mx-2 transition-all';

            if (isDisabled) {
              return (
                <div
                  key={item.label}
                  className={`${baseClasses} text-slate-600 cursor-not-allowed select-none`}
                  title={`${item.label} — select a project first`}
                >
                  <Icon path={item.icon} />
                  {sidebarOpen && <span>{item.label}</span>}
                </div>
              );
            }

            return (
              <NavLink
                key={item.label}
                to={item.to!}
                className={({ isActive }) =>
                  `${baseClasses} ${
                    isActive
                      ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-700/30'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`
                }
              >
                <Icon path={item.icon} />
                {sidebarOpen && <span>{item.label}</span>}
                {/* Unread badge on Notifications nav item */}
                {item.label === 'Notifications' && unreadCount > 0 && sidebarOpen && (
                  <span className="ml-auto bg-indigo-500 text-white text-[10px] font-bold rounded-full h-4 min-w-4 px-1 flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Sidebar footer */}
        {sidebarOpen && (
          <div className="px-4 py-3 border-t border-slate-900 text-[11px] text-slate-600">
            RankEngine AI v1.0
          </div>
        )}
      </aside>

      {/* ──────────────────────────────── MAIN AREA ── */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* ─────────────── TOP HEADER ─────────────── */}
        <header className="h-16 bg-slate-950 border-b border-slate-900 flex items-center justify-end px-6 gap-3 flex-shrink-0">

          {/* ── Notification Bell ── */}
          <div className="relative">
            <button
              id="notification-bell-btn"
              onClick={() => { setBellOpen((o) => !o); setUserMenuOpen(false); }}
              className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all"
              aria-label="Notifications"
            >
              <Icon path="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              {unreadCount > 0 && (
                <span
                  id="notification-unread-badge"
                  className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center leading-none"
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* Bell dropdown */}
            {bellOpen && (
              <div
                id="notification-dropdown"
                className="absolute right-0 mt-2 w-80 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl shadow-black/60 z-50 overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="text-xs text-indigo-400">{unreadCount} unread</span>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="text-slate-500 text-xs text-center py-8">
                      No notifications yet
                    </p>
                  ) : (
                    notifications.slice(0, 10).map((n) => (
                      <div
                        key={n._id}
                        className={`px-4 py-3 border-b border-slate-800/50 flex items-start gap-3 hover:bg-slate-800/40 transition-colors cursor-pointer ${
                          !n.read ? 'bg-indigo-950/30' : ''
                        }`}
                        onClick={() => !n.read && markRead(n._id)}
                      >
                        <span
                          className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                            n.read ? 'bg-slate-700' : 'bg-indigo-400'
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs leading-relaxed ${n.read ? 'text-slate-400' : 'text-slate-200'}`}>
                            {n.message}
                          </p>
                          <p className="text-[10px] text-slate-600 mt-0.5">
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
              className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-lg hover:bg-slate-800 transition-all"
            >
              <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white text-xs font-bold select-none">
                {initials}
              </div>
              {user?.name && (
                <span className="text-sm text-slate-300 hidden sm:block max-w-28 truncate">
                  {user.name}
                </span>
              )}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 text-slate-500"
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
                className="absolute right-0 mt-2 w-48 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl shadow-black/60 z-50 overflow-hidden py-1"
              >
                <div className="px-4 py-2.5 border-b border-slate-800">
                  <p className="text-xs font-semibold text-white truncate">{user?.name}</p>
                  <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
                </div>
                <NavLink
                  to="/settings"
                  onClick={() => setUserMenuOpen(false)}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-2"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4 text-slate-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  Settings
                </NavLink>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors flex items-center gap-2"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4 text-slate-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                  Logout
                </button>
              </div>
            )}
          </div>
        </header>

        {/* ─────────────── PAGE CONTENT ─────────────── */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
