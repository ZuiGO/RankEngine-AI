import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import '@uiw/react-markdown-preview/markdown.css';
import api from '../lib/api';
import { Card, Badge, EmptyState } from '../components/ui';
import AIWriterPanel from '../components/AIWriterPanel';

interface GradeBreakdown {
  entityCoverage: number;
  structureScore: number;
  readability: number;
}

interface H2Analysis {
  heading: string;
  wordCount: number;
  isValid: boolean;
  warning?: string;
}

const analyzeH2Headings = (text: string): H2Analysis[] => {
  const lines = text.split('\n');
  const results: H2Analysis[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const isH2 = line.startsWith('## ') || /^<h2>/i.test(line);
    if (isH2) {
      const headingText = line
        .replace(/^##\s+/, '')
        .replace(/<[^>]*>/g, '')
        .trim();

      let nextParagraphText = '';
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (nextLine.length > 0) {
          if (nextLine.startsWith('#') || /^<h[1-6]/i.test(nextLine)) {
            break;
          }
          nextParagraphText = nextLine;
          break;
        }
      }

      const words = nextParagraphText.split(/\s+/).filter((w) => w.length > 0);
      const wordCount = nextParagraphText ? words.length : 0;
      const isValid = wordCount >= 40 && wordCount <= 80;

      results.push({
        heading: headingText,
        wordCount,
        isValid,
        warning: !isValid
          ? 'Add a 40–80 word direct answer here for AI Overview eligibility'
          : undefined,
      });
    }
  }

  return results;
};

export default function ContentEditorPage() {
  const [searchParams] = useSearchParams();
  const urlKeyword = searchParams.get('keyword');
  const urlTopic = searchParams.get('topic');
  const [text, setText] = useState(
    urlTopic
      ? `## ${urlTopic}\n\nStart writing content about ${urlTopic} here.`
      : '## AI Overview Check\n\nThis is the first paragraph. We want to write at least 40 words here to verify direct answer opportunities. RankEngine automatically analyses content headings to test eligibility markers. Write a complete description containing enough syllables to test readability too.\n\n## Syllable check\n\nAnother paragraph follows this heading to check structure scores.',
  );
  const [targetKeyword, setTargetKeyword] = useState(urlKeyword || 'rankengine');

  const [sharedEntities, setSharedEntities] = useState<string[]>([]);
  const [sharedSubtopics, setSharedSubtopics] = useState<string[]>([]);
  const [serpLoading, setSerpLoading] = useState(false);
  const [serpError, setSerpError] = useState('');

  const [h2Analyses, setH2Analyses] = useState<H2Analysis[]>([]);

  const [score, setScore] = useState(0);
  const [breakdown, setBreakdown] = useState<GradeBreakdown>({
    entityCoverage: 0,
    structureScore: 0,
    readability: 0,
  });
  const [gradingLoading, setGradingLoading] = useState(false);

  useEffect(() => {
    const analyses = analyzeH2Headings(text);
    setH2Analyses(analyses);

    const timer = setTimeout(() => {
      fetchGraderResults();
    }, 300);

    return () => clearTimeout(timer);
  }, [text, targetKeyword, sharedEntities]);

  const fetchGraderResults = async () => {
    setGradingLoading(true);
    try {
      const { data } = await api.post<{ score: number; breakdown: GradeBreakdown }>('/content/grade', {
        text,
        targetKeyword,
        sharedEntities,
      });
      setScore(data.score);
      setBreakdown(data.breakdown);
    } catch (err) {
      console.error('[Grader Fetch Error]:', err);
    } finally {
      setGradingLoading(false);
    }
  };

  const runSerpAnalysis = async () => {
    if (!targetKeyword.trim()) {
      setSerpError('Keyword parameter is required');
      return;
    }
    setSerpError('');
    setSerpLoading(true);
    try {
      const { data } = await api.post<{ sharedEntities: string[]; sharedSubtopics: string[] }>(
        '/content/serp-analysis',
        { keyword: targetKeyword },
      );
      setSharedEntities(data.sharedEntities || []);
      setSharedSubtopics(data.sharedSubtopics || []);
    } catch (err: any) {
      setSerpError(err?.response?.data?.error || 'SERP analysis failed');
    } finally {
      setSerpLoading(false);
    }
  };

  const getIndicatorColor = (val: number) => {
    if (val >= 80) return 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20';
    if (val >= 50) return 'text-amber-400 bg-amber-500/10 border border-amber-500/20';
    return 'text-rose-500 bg-rose-500/10 border border-rose-500/20';
  };

  const getScoreCircleColor = (val: number) => {
    if (val >= 80) return 'stroke-emerald-400';
    if (val >= 50) return 'stroke-amber-400';
    return 'stroke-rose-500';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <Link
          to="/"
          className="text-xs text-app-signal hover:text-app-signal/80 font-semibold flex items-center space-x-1 transition-all duration-150"
        >
          <span>← Back to Dashboard</span>
        </Link>
        <span className="text-app-text-muted text-xs">Real-Time SEO Editor</span>
      </div>

      <Card className="p-4 mb-6 flex flex-col md:flex-row md:items-center space-y-4 md:space-y-0 md:space-x-4">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-app-text-muted mb-1.5">Target Keyword</label>
          <input
            type="text"
            className="w-full bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3.5 py-2 text-sm text-white placeholder-app-text-muted outline-none transition-all duration-150 font-semibold"
            placeholder="e.g. rankengine optimization"
            value={targetKeyword}
            onChange={(e) => setTargetKeyword(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={runSerpAnalysis}
            disabled={serpLoading}
            className="w-full md:w-auto bg-app-base hover:bg-app-surface border border-app-border hover:border-app-surface text-app-signal hover:text-app-signal/80 font-bold text-sm px-6 py-2 rounded-lg transition-all duration-150 flex items-center justify-center space-x-2"
          >
            {serpLoading ? 'Analyzing...' : 'Run SERP Analysis'}
          </button>
        </div>
      </Card>

      {serpError && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-6">
          {serpError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 space-y-6">
          <Card className="p-5">
            <h3 className="text-sm font-bold text-white mb-3">Document Editor</h3>
            <div data-color-mode="dark">
              <MDEditor
                value={text}
                onChange={(val) => setText(val || '')}
                height={400}
                preview="edit"
              />
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-bold text-white mb-4">AI Overview H2 Direct-Answer Validation</h3>
            {h2Analyses.length === 0 ? (
              <EmptyState compact title="No H2 headings detected" description='Add "## Heading" to trigger validations.' />
            ) : (
              <div className="space-y-3">
                {h2Analyses.map((analysis, idx) => (
                  <div
                    key={idx}
                    className={`p-3.5 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                      analysis.isValid
                        ? 'bg-emerald-500/5 border-emerald-500/15 text-emerald-400'
                        : 'bg-rose-500/5 border-rose-500/15 text-rose-400'
                    }`}
                  >
                    <div>
                      <h4 className="font-bold text-sm text-app-text">
                        H2: <span className="italic">"{analysis.heading}"</span>
                      </h4>
                      <p className="text-xs text-app-text-muted mt-1">
                        {analysis.isValid ? (
                          <span className="text-emerald-400 font-semibold">✓ Perfect direct-answer paragraph length!</span>
                        ) : (
                          <span>{analysis.warning}</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge variant="default" className="font-mono">
                        {analysis.wordCount} words
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-5 space-y-6">
          <Card className="p-6 text-center relative overflow-hidden">
            <h3 className="text-sm font-bold text-white mb-6 text-left flex items-center justify-between">
              <span>SEO Content Score</span>
              {gradingLoading && <span className="text-2xs text-app-signal font-normal">Analyzing...</span>}
            </h3>

            {text.trim().length < 20 && !gradingLoading ? (
              <EmptyState
                icon={<Pencil className="h-6 w-6" />}
                title="Start writing to see your score"
                description="We'll analyze entity coverage, heading structure, and readability against your target keyword in real time."
              />
            ) : (
              <>
                <div className="relative w-40 h-40 mx-auto flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle
                      className="stroke-app-border"
                      strokeWidth="8"
                      fill="transparent"
                      r="38"
                      cx="50"
                      cy="50"
                    />
                    <circle
                      className={`transition-all duration-500 ease-out ${getScoreCircleColor(score)}`}
                      strokeWidth="8"
                      strokeDasharray={`${2 * Math.PI * 38}`}
                      strokeDashoffset={`${2 * Math.PI * 38 * (1 - score / 100)}`}
                      strokeLinecap="round"
                      fill="transparent"
                      r="38"
                      cx="50"
                      cy="50"
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center">
                    <span className="text-4xl font-extrabold text-white tracking-tight">{score}</span>
                    <span className="text-2xs text-app-text-muted uppercase font-semibold">Grade</span>
                  </div>
                </div>

                <div className="space-y-4 mt-8 text-left">
                  <div>
                    <div className="flex justify-between text-xs font-bold text-app-text mb-1">
                      <span>Entity Coverage</span>
                      <span className={`px-2 py-0.5 rounded text-2xs font-mono font-bold ${getIndicatorColor(breakdown.entityCoverage)}`}>
                        {breakdown.entityCoverage}%
                      </span>
                    </div>
                    <div className="w-full bg-app-base h-2 rounded-full overflow-hidden border border-app-border">
                      <div
                        className={`h-full transition-all duration-300 ${
                          breakdown.entityCoverage >= 80 ? 'bg-emerald-400' : breakdown.entityCoverage >= 50 ? 'bg-amber-400' : 'bg-rose-500'
                        }`}
                        style={{ width: `${breakdown.entityCoverage}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-bold text-app-text mb-1">
                      <span>Structure Score</span>
                      <span className={`px-2 py-0.5 rounded text-2xs font-mono font-bold ${getIndicatorColor(breakdown.structureScore)}`}>
                        {breakdown.structureScore}%
                      </span>
                    </div>
                    <div className="w-full bg-app-base h-2 rounded-full overflow-hidden border border-app-border">
                      <div
                        className={`h-full transition-all duration-300 ${
                          breakdown.structureScore >= 80 ? 'bg-emerald-400' : breakdown.structureScore >= 50 ? 'bg-amber-400' : 'bg-rose-500'
                        }`}
                        style={{ width: `${breakdown.structureScore}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-bold text-app-text mb-1">
                      <span>Readability Ease</span>
                      <span className={`px-2 py-0.5 rounded text-2xs font-mono font-bold ${getIndicatorColor(breakdown.readability)}`}>
                        {breakdown.readability}%
                      </span>
                    </div>
                    <div className="w-full bg-app-base h-2 rounded-full overflow-hidden border border-app-border">
                      <div
                        className={`h-full transition-all duration-300 ${
                          breakdown.readability >= 80 ? 'bg-emerald-400' : breakdown.readability >= 50 ? 'bg-amber-400' : 'bg-rose-500'
                        }`}
                        style={{ width: `${breakdown.readability}%` }}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </Card>

          <Card className="p-6">
            <h3 className="text-sm font-bold text-white mb-4">Competitor SEO Checklist</h3>
            {sharedEntities.length === 0 && sharedSubtopics.length === 0 ? (
              <EmptyState compact title="Run SERP Analysis" description="Populate competitor target checklists." />
            ) : (
              <div className="space-y-6">
                {sharedEntities.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-app-signal uppercase tracking-wider mb-2.5">
                      Target Entities
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {sharedEntities.map((ent, idx) => {
                        const isFound = text.toLowerCase().includes(ent.toLowerCase());
                        return (
                          <div
                            key={idx}
                            className={`flex items-center space-x-2 text-xs p-2 rounded-lg border ${
                              isFound
                                ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400 line-through'
                                : 'bg-app-base border-app-border text-app-text-muted'
                            }`}
                          >
                            <span>{isFound ? '✓' : '○'}</span>
                            <span className="truncate">{ent}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {sharedSubtopics.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-app-signal uppercase tracking-wider mb-2.5">
                      Recommended Subtopics
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {sharedSubtopics.map((topic, idx) => {
                        const isFound = text.toLowerCase().includes(topic.toLowerCase());
                        return (
                          <div
                            key={idx}
                            className={`flex items-center space-x-2 text-xs p-2 rounded-lg border ${
                              isFound
                                ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400 line-through'
                                : 'bg-app-base border-app-border text-app-text-muted'
                            }`}
                          >
                            <span>{isFound ? '✓' : '○'}</span>
                            <span className="truncate">{topic}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          <AIWriterPanel
            targetKeyword={targetKeyword}
            pageContext={text}
            onInsert={(inserted) => setText((prev) => prev + '\n\n' + inserted)}
          />
        </div>
      </div>
    </div>
  );
}
