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
    <div className="bg-app-signal/10 border-b border-app-signal/20 px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <p className="text-xs text-app-text">
          <span className="text-app-signal font-semibold">Feature locked.</span>{' '}
          Upgrade to <span className="font-bold text-white capitalize">{requiredPlan}</span> to unlock{' '}
          <span className="text-app-signal/80 font-medium">{feature}</span>.
        </p>
        <div className="flex items-center gap-3">
          <Link
            to={`/pricing`}
            className="bg-app-signal hover:bg-app-signal/90 text-app-base text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            View Plans
          </Link>
          <button
            onClick={() => setVisible(false)}
            className="text-app-text-muted hover:text-app-text text-xs transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
