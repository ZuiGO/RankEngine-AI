import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button, Badge } from '../components/ui';
import { PageTransition } from '../components/PageTransition';
import api from '../lib/api';

interface PlanData {
  id: string;
  name: string;
  price: number;
  dataProviderMonthlyLimit: number;
  projects: number;
  keywords: number;
  teamSeats: number;
  features: Record<string, boolean>;
  hasPrice: boolean;
}

const FEATURE_LABELS: Record<string, string> = {
  audit: 'Site audits & migration checks',
  keywordTracking: 'Keyword rank tracking',
  backlinks: 'Backlink analysis',
  aiVisibility: 'AI visibility monitoring',
  domainOverview: 'Domain overview & SERP history',
  gapAnalysis: 'Competitor gap analysis',
  contentEditor: 'Content optimization editor with AI grading',
  keywordResearch: 'Keyword research & discovery',
  apiAccess: 'API access',
  whiteLabel: 'White-label PDF exports',
  prioritySupport: 'Priority support',
};

const FEATURE_DISPLAY_ORDER = [
  'audit',
  'contentEditor',
  'keywordTracking',
  'keywordResearch',
  'backlinks',
  'aiVisibility',
  'domainOverview',
  'gapAnalysis',
  'apiAccess',
  'whiteLabel',
  'prioritySupport',
];

const QUOTA_FIELDS: { key: keyof PlanData; label: string }[] = [
  { key: 'projects', label: 'Projects' },
  { key: 'keywords', label: 'Tracked keywords' },
  { key: 'teamSeats', label: 'Team seats' },
  { key: 'dataProviderMonthlyLimit', label: 'Data API calls / mo' },
];

export default function PricingPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselected = searchParams.get('plan');

  const [plans, setPlans] = useState<PlanData[]>([]);
  const [currentPlan, setCurrentPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const { data } = await api.get<PlanData[]>('/billing/plans');
        setPlans(data);
      } catch {
        setError('Failed to load pricing plans.');
      } finally {
        setLoading(false);
      }
    };

    const fetchCurrentPlan = async () => {
      if (!token) return;
      try {
        const { data } = await api.get<{ plan: string }>('/billing/subscription');
        setCurrentPlan(data.plan);
      } catch {
        // user may not be fully authenticated yet
      }
    };

    Promise.all([fetchPlans(), fetchCurrentPlan()]);
  }, [token]);

  const handleCta = async (planId: string) => {
    if (!token) {
      navigate(`/register?plan=${planId}`);
      return;
    }

    if (planId === 'free') {
      navigate('/dashboard');
      return;
    }

    // Logged-in user upgrading — go directly to Stripe checkout
    setUpgrading(planId);
    setError('');
    try {
      const { data } = await api.post<{ url: string }>(
        '/billing/create-checkout-session',
        { planId },
      );
      window.location.href = data.url;
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to start checkout.');
    } finally {
      setUpgrading(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-app-base flex items-center justify-center">
        <p className="text-app-text-muted text-sm">Loading plans…</p>
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-screen bg-app-base text-white">
      {/* ── Navbar ──────────────────────────────────────── */}
      <header className="border-b border-app-border/60 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-gradient-to-tr from-indigo-600 to-indigo-500 shadow-lg shadow-indigo-500/30">
              <span className="text-white font-bold text-sm">RE</span>
            </div>
            <span className="font-bold text-lg tracking-tight">RankEngine AI</span>
          </Link>
          <div className="flex items-center gap-3">
            {token ? (
              <Link to="/dashboard">
                <Button variant="secondary">Dashboard</Button>
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-sm text-app-text-muted hover:text-white transition-colors hidden sm:inline"
                >
                  Sign in
                </Link>
                <Link to="/register">
                  <Button>Start Free</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Header ──────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6 pt-20 pb-12 text-center">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          Simple, transparent pricing
        </h1>
        <p className="text-app-text-muted mt-4 max-w-xl mx-auto">
          Start free. Upgrade when you need more projects, keywords, or team members.
        </p>
      </div>

      {/* ── Error ────────────────────────────────────────── */}
      {error && (
        <div className="max-w-6xl mx-auto px-6 mb-8">
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-4 rounded-xl">
            {error}
          </div>
        </div>
      )}

      {/* ── Plan cards ──────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6 pb-24">
        <div className="grid md:grid-cols-3 gap-6 items-start">
          {plans.map((plan, _idx) => {
            const isCurrent = currentPlan === plan.id;
            const isPreselected = preselected === plan.id;
            const isFree = plan.id === 'free';

            const border =
              isPreselected
                ? 'border-app-signal ring-1 ring-app-signal'
                : plan.id === 'agency'
                  ? 'border-app-signal/50'
                  : 'border-app-border';

            const ctaAction = isFree
              ? () => handleCta('free')
              : () => handleCta(plan.id);

            const ctaLabel = isFree
              ? 'Get Started'
              : !token
                ? `Start ${plan.name} Free`
                : isCurrent
                  ? 'Current Plan'
                  : `Upgrade to ${plan.name}`;

            const ctaDisabled = (isCurrent && token) || upgrading === plan.id;
            const ctaVariant =
              isFree && token ? 'secondary'
                : plan.id === 'agency'
                  ? 'primary'
                  : isPreselected ? 'primary' : 'secondary';

            return (
              <div
                key={plan.id}
                className={`relative bg-app-surface/70 border rounded-2xl p-6 flex flex-col transition-all ${border} ${isFree ? '' : 'md:scale-105'} ${isPreselected ? 'ring-1 ring-app-signal' : ''}`}
              >
                {/* Badges */}
                <div className="flex items-center gap-2 mb-4">
                  {isCurrent && token && (
                    <Badge variant="info" className="text-xs">Current</Badge>
                  )}
                  {isPreselected && !isCurrent && (
                    <Badge variant="success" className="text-xs">Selected</Badge>
                  )}
                  {plan.id === 'agency' && (
                    <Badge variant="success" className="text-xs">Best Value</Badge>
                  )}
                </div>

                {/* Name + Price */}
                <h2 className="text-xl font-bold">{plan.name}</h2>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold">${plan.price}</span>
                  <span className="text-app-text-muted text-sm">/ month</span>
                </div>

                {/* Quota stats */}
                <div className="mt-5 grid grid-cols-2 gap-2">
                  {QUOTA_FIELDS.map(({ key, label }) => {
                    const val = plan[key] as number;
                    return (
                      <div key={key} className="bg-app-base rounded-lg p-2.5 text-center">
                        <p className="text-base font-bold text-white">
                          {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                        </p>
                        <p className="text-2xs text-app-text-muted leading-tight">{label}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Feature list */}
                <ul className="mt-6 space-y-2.5 flex-1">
                  {FEATURE_DISPLAY_ORDER.map((key) => {
                    const enabled = plan.features[key];
                    const label = FEATURE_LABELS[key];
                    return (
                      <li
                        key={key}
                        className={`text-xs flex items-start gap-2 ${enabled ? 'text-app-text' : 'text-app-text-muted line-through'}`}
                      >
                        <svg
                          className={`h-4 w-4 mt-0.5 flex-shrink-0 ${enabled ? 'text-emerald-400' : 'text-app-text-muted'}`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d={enabled ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'} />
                        </svg>
                        {label}
                      </li>
                    );
                  })}
                </ul>

                {/* CTA */}
                <Button
                  variant={ctaVariant as 'primary' | 'secondary'}
                  disabled={!!ctaDisabled}
                  loading={upgrading === plan.id}
                  onClick={ctaAction}
                  className={`w-full mt-8 ${plan.id === 'agency' ? 'shadow-xl shadow-app-signal/30' : ''}`}
                >
                  {upgrading === plan.id ? 'Redirecting…' : ctaLabel}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className="border-t border-app-border/60">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-app-text-muted">
            <div className="inline-flex items-center justify-center h-6 w-6 rounded bg-gradient-to-tr from-indigo-600 to-indigo-500">
              <span className="text-white font-bold text-[10px]">RE</span>
            </div>
            RankEngine AI
          </div>
          <div className="flex items-center gap-6 text-xs text-app-text-muted">
            <span>&copy; {new Date().getFullYear()} RankEngine AI</span>
            <Link to="/" className="hover:text-app-text transition-colors">Home</Link>
            <Link to="/login" className="hover:text-app-text transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>
      </div>
    </PageTransition>
  );
}
