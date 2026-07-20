import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Card, CardBody, Button, Badge } from '../components/ui';
import api from '../lib/api';

interface Plan {
  id: string;
  name: string;
  price: number;
  features: string[];
}

const MONTHLY_FEATURES = [
  'Site audits & migration checks',
  'Content optimization editor with AI grading',
  'Keyword rank tracking',
  'Keyword research',
  'Backlink analysis',
  'AI visibility monitoring',
  'Competitor gap analysis',
  'Team collaboration',
  'White-label PDF exports',
];

export default function PricingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currentPlan, setCurrentPlan] = useState<string>('free');
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [{ data: plansData }, { data: subData }] = await Promise.all([
          api.get<Plan[]>('/billing/plans'),
          api.get<{ plan: string }>('/billing/subscription'),
        ]);
        setPlans(plansData);
        setCurrentPlan(subData.plan);
      } catch {
        //
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleSelectPlan = async (planId: string) => {
    setChanging(planId);
    try {
      await api.patch('/billing/subscription', { plan: planId });
      setCurrentPlan(planId);
    } catch {
      //
    } finally {
      setChanging(null);
    }
  };

  const handleGetStarted = () => {
    if (user) {
      navigate('/dashboard');
    } else {
      navigate('/register');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading plans…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Pricing & Plans
          </h1>
          <p className="text-slate-400 text-sm mt-3 max-w-lg mx-auto">
            Choose the plan that fits your agency's needs. All plans include a 14-day free trial.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const isFree = plan.id === 'free';
            return (
              <Card
                key={plan.id}
                className={`relative flex flex-col ${
                  isCurrent ? 'border-indigo-500 ring-1 ring-indigo-500' : ''
                }`}
              >
                <CardBody className="flex flex-col h-full">
                  {isCurrent && (
                    <Badge variant="info" className="absolute top-3 right-3">
                      Current
                    </Badge>
                  )}

                  <div className="mb-6">
                    <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold text-white">
                        ${plan.price}
                      </span>
                      <span className="text-slate-500 text-sm">/mo</span>
                    </div>
                  </div>

                  <ul className="space-y-2.5 mb-8 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="text-xs text-slate-400 flex items-start gap-2">
                        <svg className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        {f}
                      </li>
                    ))}
                    <li className="text-xs text-slate-400 flex items-start gap-2">
                      <svg className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      All RankEngine features
                    </li>
                  </ul>

                  {isFree ? (
                    <Button
                      variant="secondary"
                      onClick={handleGetStarted}
                      className="w-full"
                    >
                      Get Started
                    </Button>
                  ) : isCurrent ? (
                    <Button variant="ghost" disabled className="w-full">
                      Current Plan
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      loading={changing === plan.id}
                      onClick={() => handleSelectPlan(plan.id)}
                      className="w-full"
                    >
                      {changing === plan.id ? 'Updating…' : 'Select Plan'}
                    </Button>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>

        {/* Feature comparison */}
        <Card className="mt-16">
          <CardBody>
            <h2 className="text-lg font-bold text-white mb-6 text-center">
              Everything included across all plans
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {MONTHLY_FEATURES.map((feature) => (
                <div key={feature} className="flex items-center gap-3 bg-slate-950 rounded-lg p-3">
                  <div className="h-8 w-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
                    <svg className="h-4 w-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-xs text-slate-300 font-medium">{feature}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
