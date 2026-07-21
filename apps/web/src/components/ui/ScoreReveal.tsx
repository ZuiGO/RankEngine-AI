import { useEffect, useRef, useState } from 'react';
import type { ReactNode, HTMLAttributes } from 'react';

type Phase = 'idle' | 'scanning' | 'revealed';

interface ScoreRevealProps extends HTMLAttributes<HTMLDivElement> {
  score: number | null | undefined;
  children: ReactNode;
  className?: string;
}

export function ScoreReveal({ score, children, className = '', ...props }: ScoreRevealProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const prevScore = useRef(score);

  useEffect(() => {
    if (
      phase === 'idle' &&
      typeof score === 'number' &&
      (prevScore.current == null || typeof prevScore.current !== 'number')
    ) {
      setPhase('scanning');
    }
    prevScore.current = score;
  }, [score, phase]);

  return (
    <div className={`relative overflow-hidden ${className}`} {...props}>
      <div className={phase === 'scanning' ? 'scan-reveal-content' : ''}>
        {children}
      </div>
      {phase === 'scanning' && (
        <div
          className="scan-reveal-beam"
          aria-hidden="true"
          onAnimationEnd={() => setPhase('revealed')}
        />
      )}
    </div>
  );
}
