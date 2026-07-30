import { useState, useEffect } from 'react';
import { Link, useSearchParams, useParams } from 'react-router-dom';
import { Pencil, Eye } from 'lucide-react';
import MDEditor from '@uiw/react-md-editor';
import '@uiw/react-md-editor/markdown-editor.css';
import '@uiw/react-markdown-preview/markdown.css';
import api from '../lib/api';
import { Card, Badge, EmptyState } from '../components/ui';
import AIWriterPanel from '../components/AIWriterPanel';
import VisualPageInspector from '../components/VisualPageInspector';

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
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const urlKeyword = searchParams.get('keyword');
  const urlTopic = searchParams.get('topic');
  const [text, setText] = useState(
    urlTopic ? `## ${urlTopic}\n\n` : '',
  );
  const [targetKeyword, setTargetKeyword] = useState(urlKeyword || '');

  const [sharedEntities, setSharedEntities] = useState<string[]>([]);
  const [sharedSubtopics, setSharedSubtopics] = useState<string[]>([]);
  const [serpLoading, setSerpLoading] = useState(false);
  const [serpError, setSerpError] = useState('');
  const [visualInspectorOpen, setVisualInspectorOpen] = useState(false);
  const [projectDomain, setProjectDomain] = useState('');

  const [h2Analyses, setH2Analyses] = useState<H2Analysis[]>([]);

  const [score, setScore] = useState(0);
  const [breakdown, setBreakdown] = useState<GradeBreakdown>({
    entityCoverage: 0,
    structureScore: 0,
    readability: 0,
  });
  const [gradingLoading, setGradingLoading] = useState(false);

  // Fetch project domain for visual inspector
  useEffect(() => {
    if (!projectId) return;
    api.get(`/projects/${projectId}`)
      .then(({ data }) => {
        const domain = data?.project?.domain || data?.domain || '';
        setProjectDomain(domain);
      })
      .catch(() => {});
  }, [projectId]);

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

  // Auto-run SERP analysis on mount if target keyword is present
  useEffect(() => {
    if (targetKeyword.trim()) {
      runSerpAnalysis();
    }
  }, []);

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
      const entities = data.sharedEntities && data.sharedEntities.length > 0
        ? data.sharedEntities
        : [`${targetKeyword} optimization`, `${targetKeyword} strategy`, 'content relevance', 'search intent', 'user experience'];
      const subtopics = data.sharedSubtopics && data.sharedSubtopics.length > 0
        ? data.sharedSubtopics
        : [`What is ${targetKeyword}?`, `Benefits of ${targetKeyword}`, `Best practices for ${targetKeyword}`, `Key challenges` ];
      
      setSharedEntities(entities);
      setSharedSubtopics(subtopics);
    } catch (err: any) {
      setSerpError(err?.response?.data?.error || 'SERP analysis failed');
      setSharedEntities([`${targetKeyword} optimization`, `${targetKeyword} strategy`, 'content relevance', 'search intent']);
      setSharedSubtopics([`What is ${targetKeyword}?`, `Benefits of ${targetKeyword}`, `Best practices`]);
    } finally {
      setSerpLoading(false);
    }
  };

  // Helper stats
  const totalWords = text.trim() ? text.trim().split(/\s+/).filter(w => w.length > 0).length : 0;
  const readTimeMin = Math.max(1, Math.ceil(totalWords / 200));
  const h2Count = (text.match(/^##\s+/gm) || []).length + (text.match(/<h2/gi) || []).length;
  const h3Count = (text.match(/^###\s+/gm) || []).length + (text.match(/<h3/gi) || []).length;
  const kwMatches = targetKeyword.trim() ? (text.toLowerCase().match(new RegExp(targetKeyword.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length : 0;
  const kwDensity = totalWords > 0 ? ((kwMatches / totalWords) * 100).toFixed(1) : '0.0';

  const [copied, setCopied] = useState(false);

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInsertEntity = (entity: string) => {
    setText((prev) => prev + `\n\n### Key Concept: ${entity}\nIncorporating ${entity} provides comprehensive coverage for target search queries.`);
  };

  const handleGenerateFAQBlock = () => {
    setText((prev) => prev + `\n\n## What is ${targetKeyword}?\n${targetKeyword} is a critical component of modern digital strategy that helps websites rank higher in search results, drive qualified organic traffic, and deliver a superior user experience for target audiences.\n`);
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVisualInspectorOpen(true)}
            className="px-3 py-1 bg-app-signal/10 border border-app-signal/30 hover:bg-app-signal/20 text-xs font-bold text-app-signal rounded-lg transition-all flex items-center gap-1.5"
          >
            <Eye className="h-3.5 w-3.5" />
            Inspect & Fix Visually
          </button>
          <button
            onClick={handleCopyMarkdown}
            className="px-3 py-1 bg-app-surface border border-app-border hover:border-app-signal text-xs font-semibold text-white rounded-lg transition-all"
          >
            {copied ? '✓ Copied!' : 'Copy Markdown'}
          </button>
          <span className="text-app-text-muted text-xs font-mono">Real-Time SEO Editor v2.0</span>
        </div>
      </div>

      {/* Target Keyword Bar */}
      <Card className="p-4 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex-1">
          <label className="block text-2xs uppercase font-bold text-app-signal tracking-wider mb-1">Target Search Keyword</label>
          <input
            type="text"
            className="w-full bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3.5 py-2 text-sm text-white placeholder-app-text-muted outline-none transition-all duration-150 font-semibold"
            placeholder="e.g. rankengine optimization"
            value={targetKeyword}
            onChange={(e) => setTargetKeyword(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 self-end md:self-auto">
          <button
            onClick={runSerpAnalysis}
            disabled={serpLoading}
            className="bg-app-signal hover:bg-app-signal/90 text-app-base font-bold text-xs px-5 py-2.5 rounded-lg transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {serpLoading ? 'Analyzing SERP…' : 'Re-Run SERP Analysis'}
          </button>
        </div>
      </Card>

      {/* Live Document Metrics Header Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card className="p-3.5 border-app-border/60">
          <p className="text-2xs font-semibold text-app-text-muted uppercase">Word Count</p>
          <p className="text-lg font-bold text-white mt-0.5">{totalWords} <span className="text-xs text-app-text-muted font-normal">words</span></p>
        </Card>
        <Card className="p-3.5 border-app-border/60">
          <p className="text-2xs font-semibold text-app-text-muted uppercase">Keyword Density</p>
          <p className={`text-lg font-bold mt-0.5 ${Number(kwDensity) >= 1.0 && Number(kwDensity) <= 2.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {kwDensity}% <span className="text-xs text-app-text-muted font-normal">({kwMatches}x)</span>
          </p>
        </Card>
        <Card className="p-3.5 border-app-border/60">
          <p className="text-2xs font-semibold text-app-text-muted uppercase">Headings</p>
          <p className="text-lg font-bold text-white mt-0.5">{h2Count} <span className="text-xs text-app-text-muted font-normal">H2s</span> / {h3Count} <span className="text-xs text-app-text-muted font-normal">H3s</span></p>
        </Card>
        <Card className="p-3.5 border-app-border/60">
          <p className="text-2xs font-semibold text-app-text-muted uppercase">Est. Read Time</p>
          <p className="text-lg font-bold text-white mt-0.5">~{readTimeMin} <span className="text-xs text-app-text-muted font-normal">min</span></p>
        </Card>
      </div>

      {serpError && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-6">
          {serpError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Markdown Editor + Quick AI Actions */}
        <div className="lg:col-span-7 space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white">Document Editor</h3>
              <button
                onClick={handleGenerateFAQBlock}
                className="px-2.5 py-1 text-2xs font-bold rounded bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/30 transition-all"
              >
                + Insert AI Overview H2 Block
              </button>
            </div>
            <div data-color-mode="dark">
              <MDEditor
                value={text}
                onChange={(val) => setText(val || '')}
                height={450}
                preview="edit"
              />
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-bold text-white mb-4">AI Overview H2 Direct-Answer Validation</h3>
            {h2Analyses.length === 0 ? (
              <EmptyState compact title="No H2 headings detected" description='Add "## Heading" to trigger direct-answer validations.' />
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
                          <span className="text-emerald-400 font-semibold">✓ Perfect direct-answer paragraph length (40–80 words)!</span>
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

        {/* Right Column: Score Breakdown + SERP Target Entities Checklist + AI Writer */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="p-6 text-center relative overflow-hidden">
            <h3 className="text-sm font-bold text-white mb-6 text-left flex items-center justify-between">
              <span>SEO Content Score</span>
              {gradingLoading && <span className="text-2xs text-app-signal font-normal animate-pulse">Analyzing…</span>}
            </h3>

            {text.trim().length < 20 && !gradingLoading ? (
              <EmptyState
                icon={<Pencil className="h-6 w-6" />}
                title="Start writing to see your score"
                description="We analyze entity coverage, heading structure, and readability against your target keyword in real time."
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

          {/* Interactive SERP Entity Checklist */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">Competitor Entity Checklist</h3>
              <span className="text-2xs text-app-text-muted">Click <b>+</b> to insert into editor</span>
            </div>
            {sharedEntities.length === 0 && sharedSubtopics.length === 0 ? (
              <EmptyState compact title="No entities loaded" description="Enter a keyword and run SERP analysis." />
            ) : (
              <div className="space-y-6">
                {sharedEntities.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-app-signal uppercase tracking-wider mb-2.5">
                      Target Entities ({sharedEntities.filter(e => text.toLowerCase().includes(e.toLowerCase())).length}/{sharedEntities.length})
                    </h4>
                    <div className="space-y-1.5">
                      {sharedEntities.map((ent, idx) => {
                        const isFound = text.toLowerCase().includes(ent.toLowerCase());
                        return (
                          <div
                            key={idx}
                            className={`flex items-center justify-between text-xs p-2 rounded-lg border ${
                              isFound
                                ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400'
                                : 'bg-app-base border-app-border text-app-text-muted hover:border-app-signal/30'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate pr-2">
                              <span>{isFound ? '✓' : '○'}</span>
                              <span className={`truncate ${isFound ? 'line-through' : ''}`}>{ent}</span>
                            </div>
                            {!isFound && (
                              <button
                                onClick={() => handleInsertEntity(ent)}
                                title="Insert into editor"
                                className="px-2 py-0.5 text-2xs font-bold rounded bg-app-signal/10 text-app-signal hover:bg-app-signal/20 border border-app-signal/30 flex-shrink-0 transition-all"
                              >
                                + Add
                              </button>
                            )}
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
                    <div className="space-y-1.5">
                      {sharedSubtopics.map((topic, idx) => {
                        const isFound = text.toLowerCase().includes(topic.toLowerCase());
                        return (
                          <div
                            key={idx}
                            className={`flex items-center justify-between text-xs p-2 rounded-lg border ${
                              isFound
                                ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400'
                                : 'bg-app-base border-app-border text-app-text-muted hover:border-app-signal/30'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate pr-2">
                              <span>{isFound ? '✓' : '○'}</span>
                              <span className={`truncate ${isFound ? 'line-through' : ''}`}>{topic}</span>
                            </div>
                            {!isFound && (
                              <button
                                onClick={() => setText((prev) => prev + `\n\n## ${topic}\nWrite detailed coverage about ${topic} here.\n`)}
                                title="Insert H2 section"
                                className="px-2 py-0.5 text-2xs font-bold rounded bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/30 flex-shrink-0 transition-all"
                              >
                                + Add H2
                              </button>
                            )}
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
            sharedEntities={sharedEntities}
            onInsert={(inserted) => setText((prev) => prev + '\n\n' + inserted)}
            onReplaceContent={(newText) => setText(newText)}
          />
        </div>
      </div>

      <VisualPageInspector
        isOpen={visualInspectorOpen}
        onClose={() => setVisualInspectorOpen(false)}
        targetUrl={
          projectDomain
            ? (projectDomain.startsWith('http') ? projectDomain : `https://${projectDomain}`)
            : 'https://example.com'
        }
      />
    </div>
  );
}
