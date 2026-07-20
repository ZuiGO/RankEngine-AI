import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Card, CardBody, Badge, Button } from '../components/ui';
import api from '../lib/api';

interface PlanInfo {
  id: string;
  name: string;
  dataProviderMonthlyLimit: number;
  projects: number;
  keywords: number;
  teamSeats: number;
  hasPrice: boolean;
}

interface SubscriptionInfo {
  plan: string;
  planName: string;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  dataProviderMonthlyLimit: number;
  projects: number;
  keywords: number;
  seats: number;
  currentPeriodEnd: string | null;
}

const PLAN_FEATURES: Record<string, string[]> = {
  free: [
    'Site audits & migration checks',
    'Content optimization editor',
    '1 project',
    '10 tracked keywords',
    '100 data API calls / mo',
    '1 team seat',
  ],
  pro: [
    'Everything in Free, plus:',
    'Keyword rank tracking',
    'Keyword research',
    'API access',
    '20 projects',
    '200 tracked keywords',
    '2,000 data API calls / mo',
    '5 team seats',
  ],
  agency: [
    'Everything in Pro, plus:',
    'Backlink analysis',
    'AI visibility monitoring',
    'Domain overview',
    'Competitor gap analysis',
    'White-label reports',
    'Priority support',
    '100 projects',
    '1,000 tracked keywords',
    '10,000 data API calls / mo',
    '25 team seats',
  ],
};

const PLAN_COLORS: Record<string, string> = {
  free: 'border-slate-700',
  pro: 'border-indigo-600/50',
  agency: 'border-violet-600/50',
};

export default function BillingPage() {
  const { profile, refreshProfile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [successBanner, setSuccessBanner] = useState(false);
  const [canceledBanner, setCanceledBanner] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [plansRes, subRes] = await Promise.all([
        api.get<PlanInfo[]>('/billing/plans'),
        api.get<SubscriptionInfo>('/billing/subscription'),
      ]);
      setPlans(plansRes.data);
      setSubscription(subRes.data);
    } catch {
      setError('Failed to load billing data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (searchParams.get('success') === '1') {
      setSuccessBanner(true);
      setSearchParams({}, { replace: true });
      fetchData();
      refreshProfile();
    }
    if (searchParams.get('canceled') === '1') {
      setCanceledBanner(true);
      setSearchParams({}, { replace: true });
    }
  }, []);

  const handleManageBilling = async () => {
    try {
      const { data } = await api.get<{ url: string }>('/billing/portal-session');
      window.location.href = data.url;
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to open billing portal.');
    }
  };

  const handleUpgrade = async (planId: string) => {
    setUpgrading(planId);
    setError('');
    try {
      const { data } = await api.post<{ url: string }>(
        '/billing/create-checkout-session',
        { planId },
      );
      window.location.href = data.url;
    } catch (err: any) {
      setError(
        err?.response?.data?.error || 'Failed to start checkout. Please try again.',
      );
    } finally {
      setUpgrading(null);
    }
  };

  const planId = subscription?.plan ?? 'free';
  const isFree = planId === 'free';
  const quotaUsed = profile?.dataProviderCallsThisMonth ?? 0;
  const quotaLimit = subscription?.dataProviderMonthlyLimit ?? 100;
  const quotaPct = quotaLimit > 0 ? Math.round((quotaUsed / quotaLimit) * 100) : 0;

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-4 animate-pulse">
        <div className="h-6 w-36 bg-slate-800 rounded" />
        <div className="h-40 bg-slate-900 border border-slate-800 rounded-2xl" />
        <div className="h-20 bg-slate-900 border border-slate-800 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
          <Link to="/settings" className="hover:text-indigo-400 transition-colors">
            Settings
          </Link>
          <span>/</span>
          <span className="text-slate-300">Billing</span>
        </div>
        <h1 className="text-2xl font-bold text-white">Billing</h1>
        <p className="text-slate-400 text-sm mt-1">
          Manage your subscription, view usage, and upgrade your plan.
        </p>
      </div>

      {/* Success banner */}
      {successBanner && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs p-4 rounded-xl flex items-center justify-between">
          <span className="font-semibold">
            Your subscription has been updated successfully! Welcome aboard.
          </span>
          <button
            onClick={() => setSuccessBanner(false)}
            className="text-emerald-400/60 hover:text-emerald-300 ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Canceled banner */}
      {canceledBanner && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs p-4 rounded-xl flex items-center justify-between">
          <span className="font-semibold">
            Checkout was canceled. No changes were made to your subscription.
          </span>
          <button
            onClick={() => setCanceledBanner(false)}
            className="text-amber-400/60 hover:text-amber-300 ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-4 rounded-xl">
          {error}
        </div>
      )}

      {/* Current Plan */}
      <Card>
        <CardBody>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-white">Current Plan</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {isFree
                  ? 'You are on the Free plan.'
                  : `You are on the ${subscription?.planName ?? planId} plan.`}
              </p>
            </div>
            <Badge
              variant={isFree ? 'default' : 'success'}
              className="text-xs capitalize"
            >
              {planId}
            </Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            {[
              { label: 'Projects', value: subscription?.projects ?? '-' },
              { label: 'Tracked Keywords', value: subscription?.keywords ?? '-' },
              { label: 'Team Seats', value: subscription?.seats ?? '-' },
              {
                label: 'API Calls / mo',
                value: subscription?.dataProviderMonthlyLimit?.toLocaleString() ?? '-',
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-slate-950 rounded-lg p-3 text-center"
              >
                <p className="text-lg font-bold text-white">{stat.value}</p>
                <p className="text-2xs text-slate-500">{stat.label}</p>
              </div>
            ))}
          </div>

          {subscription?.currentPeriodEnd && (
            <p className="text-xs text-slate-500 mb-3">
              Current period ends{' '}
              {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
            </p>
          )}

          {!isFree && (
            <Button
              variant="secondary"
              onClick={handleManageBilling}
              className="w-full sm:w-auto"
            >
              Manage Billing
            </Button>
          )}
        </CardBody>
      </Card>

      {/* API Usage */}
      <Card>
        <CardBody>
          <h2 className="text-sm font-bold text-white mb-3">Monthly API Usage</h2>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  quotaPct >= 90
                    ? 'bg-rose-500'
                    : quotaPct >= 70
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                }`}
                style={{ width: `${Math.min(quotaPct, 100)}%` }}
              />
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-400 flex-shrink-0">
              <span className="text-slate-200 font-semibold">{quotaUsed}</span>
              {' / '}
              <span className="text-slate-500">{quotaLimit}</span>
            </span>
          </div>
          <p className="text-2xs text-slate-600 mt-1.5">
            Data API calls reset on the 1st of each month.
          </p>
        </CardBody>
      </Card>

      {/* Plan comparison (Free users only) */}
      {isFree && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white">
              Upgrade your plan
            </h2>
            <Link
              to="/pricing"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Compare all plans →
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {plans
              .filter((p) => p.id !== 'free')
              .map((plan) => {
                const features = PLAN_FEATURES[plan.id] ?? [];
                return (
                  <Card
                    key={plan.id}
                    className={`relative flex flex-col ${PLAN_COLORS[plan.id] ?? ''}`}
                  >
                    <CardBody className="flex flex-col h-full">
                      <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                      <ul className="mt-4 space-y-2 flex-1">
                        {features.map((f) => (
                          <li
                            key={f}
                            className="text-xs text-slate-400 flex items-start gap-2"
                          >
                            <svg
                              className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2.5}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            {f}
                          </li>
                        ))}
                      </ul>
                      <Button
                        variant={plan.id === 'agency' ? 'primary' : 'secondary'}
                        loading={upgrading === plan.id}
                        onClick={() => handleUpgrade(plan.id)}
                        className="w-full mt-6"
                      >
                        {upgrading === plan.id ? 'Redirecting…' : `Upgrade to ${plan.name}`}
                      </Button>
                    </CardBody>
                  </Card>
                );
              })}
          </div>
        </section>
      )}
    </div>
  );
}
