import type { ReactNode } from 'react';

interface StatGaugeProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  previous?: number | null;
  children?: ReactNode;
}

const SCORE_CONFIG = {
  red: { stroke: '#f43f5e', text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
  yellow: { stroke: '#fbbf24', text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  green: { stroke: '#34d399', text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
};

function getConfig(score: number) {
  if (score >= 80) return SCORE_CONFIG.green;
  if (score >= 50) return SCORE_CONFIG.yellow;
  return SCORE_CONFIG.red;
}

export function StatGauge({
  score,
  size = 112,
  strokeWidth = 8,
  label,
  previous,
  children,
}: StatGaugeProps) {
  const cfg = getConfig(score);
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - score / 100);
  const delta = previous != null ? score - previous : null;

  return (
    <div className={`flex items-center gap-5 ${cfg.bg} border ${cfg.border} rounded-2xl px-5 py-4`}>
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg className="w-full h-full transform -rotate-90" viewBox={`0 0 ${size} ${size}`}>
          <circle className="stroke-slate-800" strokeWidth={strokeWidth} fill="transparent" r={r} cx={cx} cy={cy} />
          <circle
            className="transition-all duration-700 ease-out"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            fill="transparent"
            r={r}
            cx={cx}
            cy={cy}
            style={{ stroke: cfg.stroke }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-extrabold text-white">{score}</span>
          {label && <span className="text-[10px] text-slate-500 uppercase font-semibold -mt-0.5">{label}</span>}
        </div>
      </div>
      {children && (
        <div className="flex-1 min-w-0">
          {children}
          {delta !== null && (
            <p className={`text-xs mt-1 font-medium flex items-center gap-1 ${delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {delta >= 0 ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              )}
              {delta > 0 ? '+' : ''}{delta} since last
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function MiniStatGauge({ score, size = 40 }: { score: number; size?: number }) {
  const cfg = getConfig(score);
  const r = (size - 6) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - score / 100);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="w-full h-full transform -rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle className="stroke-slate-800" strokeWidth="3" fill="transparent" r={r} cx={cx} cy={cy} />
        <circle
          className="transition-all duration-500 ease-out"
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          fill="transparent"
          r={r}
          cx={cx}
          cy={cy}
          style={{ stroke: cfg.stroke }}
        />
      </svg>
      <span className={`absolute text-2xs font-bold tabular-nums ${cfg.text}`}>{score}</span>
    </div>
  );
}
