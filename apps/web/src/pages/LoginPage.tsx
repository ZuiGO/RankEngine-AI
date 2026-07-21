import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui';
import { PageTransition } from '../components/PageTransition';

export default function LoginPage() {
  const { login, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      await refreshProfile();
      navigate('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageTransition>
      <div className="min-h-screen bg-app-base flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-app-signal shadow-lg shadow-app-signal/30 mb-4">
              <span className="text-white font-bold text-lg">RE</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Welcome back</h1>
            <p className="text-app-text-muted text-sm mt-1">Sign in to your RankEngine AI account</p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="bg-app-surface border border-app-border rounded-2xl p-6 space-y-4 shadow-2xl shadow-black/40"
          >
            {error && (
              <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-lg px-4 py-2.5">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-app-text-muted mb-1.5" htmlFor="login-email">
                Email address
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-app-base border border-app-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-app-text-muted focus:outline-none focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 transition-all duration-150"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-app-text-muted mb-1.5" htmlFor="login-password">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-app-base border border-app-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-app-text-muted focus:outline-none focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 transition-all duration-150"
                placeholder="••••••••"
              />
            </div>

            <Button
              id="login-submit-btn"
              type="submit"
              disabled={loading}
              loading={loading}
              className="w-full"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>

            <p className="text-center text-xs text-app-text-muted">
              Don't have an account?{' '}
              <Link to="/register" className="text-app-signal hover:text-app-signal/80 transition-all duration-150">
                Create one
              </Link>
            </p>
          </form>
        </div>
      </div>
    </PageTransition>
  );
}
