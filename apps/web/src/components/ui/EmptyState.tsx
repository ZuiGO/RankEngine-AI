import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { fadeIn } from '../../lib/motion';
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
          <p className="text-sm text-app-text-muted">{title}</p>
          {description && <p className="text-xs text-app-text-muted mt-1">{description}</p>}
          {action && <div className="mt-4">{action}</div>}
        </CardBody>
      </Card>
    );
  }

  return (
    <motion.div
      variants={fadeIn}
      initial="hidden"
      animate="visible"
      className="text-center py-24"
    >
      {icon && (
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-app-surface border border-app-border text-app-signal mb-4">
          {icon}
        </div>
      )}
      <h2 className="text-lg font-semibold text-white mb-1">{title}</h2>
      {description && <p className="text-app-text-muted text-sm max-w-sm mx-auto mb-6">{description}</p>}
      {action}
    </motion.div>
  );
}

export function EmptyStateCard({ icon, title, description, action }: EmptyStateProps) {
  return (
    <Card>
      <CardBody className="text-center py-12">
        {icon && (
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-app-surface-raised text-app-signal mb-4">
            {icon}
          </div>
        )}
        <p className="text-app-text-muted text-sm mb-1">{title}</p>
        {description && <p className="text-app-text-muted text-xs max-w-sm mx-auto">{description}</p>}
        {action && <div className="mt-4">{action}</div>}
      </CardBody>
    </Card>
  );
}
