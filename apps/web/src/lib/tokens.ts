export const duration = {
  instant: 0,
  fast: 0.15,
  normal: 0.25,
  slow: 0.35,
  page: 0.25,
  modals: 0.2,
} as const;

export type Duration = keyof typeof duration;

export const easing = {
  out: [0, 0, 0.2, 1] as const,
  in: [0.4, 0, 1, 1] as const,
  inOut: [0.42, 0, 0.58, 1] as const,
  spring: [0.34, 1.56, 0.64, 1] as const,
  outBack: [0.34, 1.3, 0.64, 1] as const,
};

export type Easing = keyof typeof easing;

export const motion = {
  fast: { duration: duration.fast, ease: easing.out },
  normal: { duration: duration.normal, ease: easing.out },
  slow: { duration: duration.slow, ease: easing.out },
  page: { duration: duration.page, ease: easing.out },
  modals: { duration: duration.modals, ease: easing.out },
  spring: { duration: duration.normal, ease: easing.spring },
  springOut: { duration: duration.slow, ease: easing.outBack },
} as const;
