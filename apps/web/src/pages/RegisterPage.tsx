import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui';
import { PageTransition } from '../components/PageTransition';
import api from '../lib/api';

const ROLE_OPTIONS = [
  { value: 'agency_owner', label: 'Agency Owner' },
  { value: 'marketer', label: 'Marketer' },
  { value: 'developer', label: 'Developer' },
] as const;

type Role = (typeof ROLE_OPTIONS)[number]['value'];

const PLAN_LABELS: Record<string, string> = {
  pro: 'Pro',
  agency: 'Agency',
};

export default function RegisterPage() {
  const { register, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const planParam = searchParams.get('plan');
  const planName = planParam ? PLAN_LABELS[planParam] ?? null : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState<Role>('agency_owner');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(email, password, role, companyName);
      await refreshProfile();

      // If a paid plan was pre-selected, redirect to Stripe checkout
      if (planParam && planParam !== 'free') {
        const { data } = await api.post<{ url: string }>(
          '/billing/create-checkout-session',
          { planId: planParam },
        );
        window.location.href = data.url;
        return;
      }

      navigate('/dashboard');
    } catch (err: any) {
      const details = err?.response?.data?.details;
      if (details) {
        // Show first Zod field error
        const first = Object.values(details).flat()[0] as string;
        setError(first ?? 'Registration failed. Please try again.');
      } else {
        setError(err?.response?.data?.error ?? 'Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const subText = planName
    ? `You're signing up for the ${planName} plan`
    : 'Start ranking smarter with AI';

  return (
    <PageTransition>
      <div className="min-h-screen bg-app-base flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-app-signal shadow-lg shadow-app-signal/30 mb-4">
              <span className="text-white font-bold text-lg">RE</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Create your account</h1>
            <p className="text-app-text-muted text-sm mt-1">{subText}</p>
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
              <label className="block text-xs font-medium text-app-text-muted mb-1.5" htmlFor="reg-company">
                Company name
              </label>
              <input
                id="reg-company"
                type="text"
                required
                autoComplete="organization"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full bg-app-base border border-app-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-app-text-muted focus:outline-none focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 transition-all duration-150"
                placeholder="Acme Agency"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-app-text-muted mb-1.5" htmlFor="reg-email">
                Email address
              </label>
              <input
                id="reg-email"
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
              <label className="block text-xs font-medium text-app-text-muted mb-1.5" htmlFor="reg-password">
                Password
              </label>
              <input
                id="reg-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-app-base border border-app-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-app-text-muted focus:outline-none focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 transition-all duration-150"
                placeholder="Min. 8 characters"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-app-text-muted mb-1.5" htmlFor="reg-role">
                Your role
              </label>
              <select
                id="reg-role"
                required
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full bg-app-base border border-app-border rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 transition-all duration-150 appearance-none cursor-pointer"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <Button
              id="register-submit-btn"
              type="submit"
              disabled={loading}
              loading={loading}
              className="w-full"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </Button>

            {planName && (
              <div className="bg-app-signal/10 border border-app-signal/20 text-app-signal text-xs p-3 rounded-lg text-center">
                After creating your account, you'll be redirected to set up your{' '}
                <span className="font-semibold text-app-signal">{planName}</span> subscription.
              </div>
            )}

            <p className="text-center text-xs text-app-text-muted">
              Already have an account?{' '}
              <Link to="/login" className="text-app-signal hover:text-app-signal/80 transition-all duration-150">
                Sign in
              </Link>
            </p>
          </form>
        </div>
      </div>
    </PageTransition>
  );
}
