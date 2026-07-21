import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { badgePop } from '../../lib/motion';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-app-surface text-app-text border-app-border',
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  danger: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  info: 'bg-app-signal/10 text-app-signal border-app-signal/20',
};

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <motion.span
      variants={badgePop}
      initial="hidden"
      animate="visible"
      className={`inline-block text-2xs font-semibold px-2.5 py-0.5 rounded-full border ${variantStyles[variant]} ${className}`}
    >
      {children}
    </motion.span>
  );
}
