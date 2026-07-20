import type { ReactNode, HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div
      className={`bg-slate-900 border border-slate-800 rounded-2xl shadow-xl ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '', ...props }: CardProps) {
  return (
    <div className={`px-5 py-4 border-b border-slate-800/60 ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardBody({ children, className = '', ...props }: CardProps) {
  return (
    <div className={`p-5 ${className}`} {...props}>
      {children}
    </div>
  );
}
