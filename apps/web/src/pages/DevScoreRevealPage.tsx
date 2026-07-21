import { useState } from 'react';
import { PageTransition } from '../components/PageTransition';
import { ScoreReveal } from '../components/ui/ScoreReveal';
import { StatGauge } from '../components/ui/StatGauge';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';

const DEMOS = [
  { score: 92, label: 'HEALTH', prev: 85 },
  { score: 67, label: 'AI VISIBILITY', prev: null },
  { score: 34, label: 'DOMAIN AUTHORITY', prev: 34 },
  { score: 100, label: 'PERFECT', prev: null },
  { score: 0, label: 'STARTING', prev: null },
] as const;

export default function DevScoreRevealPage() {
  const [key, setKey] = useState(0);

  return (
    <PageTransition>
      <div className="mx-auto max-w-2xl space-y-10 py-16">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold text-white">Score Reveal · Dev Preview</h1>
          <p className="text-app-text-muted">
            StatGauge instances wrapped in <code className="font-mono text-xs text-app-signal">ScoreReveal</code> —
            reload to replay each.
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setKey((k) => k + 1)}>
              ↻ Re-trigger all
            </Button>
            <span className="text-xs text-app-text-muted">
              Each wrapper fires once per real score value.
            </span>
          </div>
        </div>

        {DEMOS.map((d) => (
          <Card key={`${key}-${d.label}`}>
            <CardHeader>
              <span className="text-sm font-semibold text-app-text">{d.label}</span>
            </CardHeader>
            <CardBody>
              <ScoreReveal score={d.score}>
                <StatGauge
                  score={d.score}
                  label={d.label}
                  previous={d.prev}
                  size={120}
                >
                  <div className="space-y-1">
                    <p className="text-sm text-app-text font-medium leading-snug">
                      {d.label === 'HEALTH' && 'Domain health looks strong — keep building quality backlinks.'}
                      {d.label === 'AI VISIBILITY' && 'Room to improve citation coverage across LLM datasets.'}
                      {d.label === 'DOMAIN AUTHORITY' && 'Authority is stagnant. Publish more original research.'}
                      {d.label === 'PERFECT' && 'Perfect score — all signals are optimal.'}
                      {d.label === 'STARTING' && 'No data yet. Start your first campaign to generate a score.'}
                    </p>
                  </div>
                </StatGauge>
              </ScoreReveal>
            </CardBody>
          </Card>
        ))}

        <div className="rounded-xl border border-app-border bg-app-surface p-5 text-center">
          <p className="text-xs text-app-text-muted">
            This page is dev-only (<code className="font-mono">import.meta.env.DEV</code>) and excluded from
            production builds.
          </p>
        </div>
      </div>
    </PageTransition>
  );
}
