import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Wraps a group of routes that require authentication.
 * Redirects to /login when no JWT token is present.
 * Redirects to /onboarding if the user hasn't completed onboarding.
 * Use as: <Route element={<ProtectedRoute />}> ... </Route>
 */
export default function ProtectedRoute() {
  const { token, profile, refreshProfile } = useAuth();

  useEffect(() => {
    if (token && !profile) {
      refreshProfile();
    }
  }, [token, profile, refreshProfile]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (!profile) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#020617', color: '#94a3b8', fontFamily: 'system-ui, sans-serif' }}>Loading profile…</div>;
  }

  if (!profile.hasCompletedOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}
