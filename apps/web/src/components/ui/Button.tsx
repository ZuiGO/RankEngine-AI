import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { motion } from 'framer-motion';
import { hoverLift } from '../../lib/motion';
import { duration, easing } from '../../lib/tokens';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
  loading?: boolean;
  glow?: 'citation' | 'signal';
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-app-signal hover:bg-app-signal/90 disabled:opacity-50 disabled:cursor-not-allowed text-app-base font-semibold shadow-lg shadow-app-signal/20',
  secondary:
    'bg-app-base hover:bg-app-surface border border-app-border hover:border-app-border text-app-text hover:text-white disabled:opacity-50 disabled:cursor-not-allowed',
  ghost:
    'text-app-signal hover:text-app-signal/80 hover:bg-app-surface/50 disabled:opacity-50 disabled:cursor-not-allowed',
  danger:
    'bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold',
};

export function Button({
  children,
  variant = 'primary',
  loading = false,
  glow,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <motion.button
      disabled={disabled || loading}
      {...hoverLift}
      whileHover={{
        ...hoverLift.whileHover,
        boxShadow: glow
          ? `0 0 14px color-mix(in srgb, var(--color-app-${glow}), 0.25)`
          : undefined,
      }}
      className={`inline-flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/80 ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </motion.button>
  );
}
