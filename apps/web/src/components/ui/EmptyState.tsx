import type { ReactNode } from 'react';
import { Card, CardBody } from './Card';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, compact }: EmptyStateProps) {
  if (compact) {
    return (
      <Card>
        <CardBody className="text-center py-8">
          {icon && <div className="mb-3">{icon}</div>}
          <p className="text-sm text-slate-500">{title}</p>
          {description && <p className="text-xs text-slate-600 mt-1">{description}</p>}
          {action && <div className="mt-4">{action}</div>}
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="text-center py-24">
      {icon && (
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-slate-900 border border-slate-800 text-indigo-400 mb-4">
          {icon}
        </div>
      )}
      <h2 className="text-lg font-semibold text-white mb-1">{title}</h2>
      {description && <p className="text-slate-400 text-sm max-w-sm mx-auto mb-6">{description}</p>}
      {action}
    </div>
  );
}

export function EmptyStateCard({ icon, title, description, action }: EmptyStateProps) {
  return (
    <Card>
      <CardBody className="text-center py-12">
        {icon && (
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-slate-800 text-indigo-400 mb-4">
            {icon}
          </div>
        )}
        <p className="text-slate-500 text-sm mb-1">{title}</p>
        {description && <p className="text-slate-500 text-xs max-w-sm mx-auto">{description}</p>}
        {action && <div className="mt-4">{action}</div>}
      </CardBody>
    </Card>
  );
}
