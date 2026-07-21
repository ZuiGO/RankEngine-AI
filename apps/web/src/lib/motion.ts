import type { Variants, Transition, TargetAndTransition } from 'framer-motion';

const m = {
  fast: { duration: 0.15, ease: 'easeInOut' as const },
  normal: { duration: 0.25, ease: 'easeInOut' as const },
  slow: { duration: 0.35, ease: 'easeInOut' as const },
  spring: { type: 'spring' as const, stiffness: 400, damping: 30 },
  page: { duration: 0.2, ease: 'easeInOut' as const },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: m.slow },
};

export const slideUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: m.slow },
};

export const slideDown: Variants = {
  hidden: { opacity: 0, y: -12 },
  visible: { opacity: 1, y: 0, transition: m.normal },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: m.fast },
};

export const stagger: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: m.fast },
};

export const badgePop: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1, transition: m.spring },
};

export const cardHover = {
  rest: { y: 0, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.3)' },
  hover: { y: -2, boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.4), 0 4px 6px -4px rgb(0 0 0 / 0.3)' },
  transition: { duration: 0.15, ease: 'easeOut' as const },
};

export const pageTransition: {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
  transition: Transition;
} = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: m.page,
};

export const pressScale = { whileTap: { scale: 0.97 } };

export const hoverLift = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.97 },
  transition: { duration: 0.15, ease: 'easeOut' as const },
};

export const slideFadeIn: Variants = {
  hidden: { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0, transition: m.fast },
  exit: { opacity: 0, y: -8, transition: m.fast },
};
