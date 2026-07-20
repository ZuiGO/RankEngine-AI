import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute() {
  const { token, profile, refreshProfile } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (token && !profile) {
      refreshProfile();
    }
  }, [token, profile, refreshProfile]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (!profile) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-sm">Loading…</div>;
  }

  // Don't redirect if already on onboarding — let the child route render
  if (!profile.hasCompletedOnboarding && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}
