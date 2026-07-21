import type { ReactNode, HTMLAttributes } from 'react';
import { motion } from 'framer-motion';
import { cardHover } from '../../lib/motion';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <motion.div
      initial="rest"
      whileHover="hover"
      animate="rest"
      variants={cardHover}
      className={`bg-app-surface border border-app-border rounded-2xl shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal/70 ${className}`}
      {...props}
    >
      {children}
    </motion.div>
  );
}



export function CardHeader({ children, className = '', ...props }: CardProps) {
  return (
    <div className={`px-5 py-4 border-b border-app-border ${className}`} {...props}>
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
