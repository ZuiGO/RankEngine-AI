import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

export function UpgradeBanner() {
  const [visible, setVisible] = useState(false);
  const [feature, setFeature] = useState('');
  const [requiredPlan, setRequiredPlan] = useState('pro');

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setFeature(detail.feature);
      setRequiredPlan(detail.requiredPlan);
      setVisible(true);
    };

    window.addEventListener('upgrade-required', handler);
    return () => window.removeEventListener('upgrade-required', handler);
  }, []);

  if (!visible) return null;

  return (
    <div className="bg-indigo-950/80 border-b border-indigo-800/30 px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <p className="text-xs text-slate-300">
          <span className="text-indigo-300 font-semibold">Feature locked.</span>{' '}
          Upgrade to <span className="font-bold text-white capitalize">{requiredPlan}</span> to unlock{' '}
          <span className="text-indigo-200 font-medium">{feature}</span>.
        </p>
        <div className="flex items-center gap-3">
          <Link
            to={`/pricing`}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            View Plans
          </Link>
          <button
            onClick={() => setVisible(false)}
            className="text-slate-500 hover:text-slate-300 text-xs transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
