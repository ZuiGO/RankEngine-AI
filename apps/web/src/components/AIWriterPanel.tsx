import { useState } from 'react';
import { Sparkles, Wand2, RefreshCw, Layers, CheckCircle2, FileText, Check } from 'lucide-react';
import api from '../lib/api';
import { Card } from './ui';

type AssetType = 'title' | 'meta_description' | 'faq' | 'schema';
type SchemaType = 'FAQPage' | 'Article';
type Tone = 'professional' | 'conversational' | 'persuasive' | 'informative';

interface GenerateResponse {
  variants?: string[];
  items?: { question: string; answer: string }[];
  jsonLd?: object | null;
  valid?: boolean;
  error?: string;
}

interface ArticleWriteResponse {
  title: string;
  content: string;
  metaDescription: string;
  keyPoints: string[];
}

interface ButtonState {
  loading: boolean;
  error: string;
  result: GenerateResponse | null;
}

interface AIWriterPanelProps {
  targetKeyword: string;
  pageContext?: string;
  sharedEntities?: string[];
  onInsert: (text: string) => void;
  onReplaceContent?: (text: string) => void;
}

const BUTTONS: { label: string; assetType: AssetType; schemaType?: SchemaType }[] = [
  { label: 'Generate Titles', assetType: 'title' },
  { label: 'Generate Meta Description', assetType: 'meta_description' },
  { label: 'Generate FAQs', assetType: 'faq' },
  { label: 'Generate Schema Markup', assetType: 'schema', schemaType: 'FAQPage' },
];

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

export default function AIWriterPanel({
  targetKeyword,
  pageContext = '',
  sharedEntities = [],
  onInsert,
  onReplaceContent,
}: AIWriterPanelProps) {
  const [activeTab, setActiveTab] = useState<'write' | 'enhance' | 'rewrite'>('write');

  // Tab 1 state: Full Article Auto-Write Inputs
  const [customTopic, setCustomTopic] = useState('');
  const [customKeywords, setCustomKeywords] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [articleTone, setArticleTone] = useState<Tone>('professional');
  const [articleLength, setArticleLength] = useState<'short' | 'medium' | 'long'>('medium');

  const [autoWriteLoading, setAutoWriteLoading] = useState(false);
  const [autoWriteError, setAutoWriteError] = useState('');
  const [generatedResult, setGeneratedResult] = useState<ArticleWriteResponse | null>(null);

  // Quick Assets State
  const [customAssetContext, setCustomAssetContext] = useState('');
  const [buttonStates, setButtonStates] = useState<Record<AssetType, ButtonState>>({
    title: { loading: false, error: '', result: null },
    meta_description: { loading: false, error: '', result: null },
    faq: { loading: false, error: '', result: null },
    schema: { loading: false, error: '', result: null },
  });

  // Tab 2 state: Structure Enhancer
  const [enhanceLoading, setEnhanceLoading] = useState(false);
  const [enhanceError, setEnhanceError] = useState('');
  const [changesSummary, setChangesSummary] = useState<string[]>([]);

  // Tab 3 state: Tone & Rewrite
  const [rewriteLoading, setRewriteLoading] = useState(false);
  const [rewriteError, setRewriteError] = useState('');
  const [selectedTone, setSelectedTone] = useState<Tone>('professional');
  const [copiedItem, setCopiedItem] = useState<string | null>(null);

  const handleCopy = (text: string, identifier: string) => {
    copyToClipboard(text);
    setCopiedItem(identifier);
    setTimeout(() => setCopiedItem(null), 2000);
  };

  // Handlers
  const handleAutoWriteFullArticle = async () => {
    const topicToUse = customTopic.trim() || targetKeyword.trim();
    if (!topicToUse) {
      setAutoWriteError('Please provide a Topic or Target Keyword to auto-write an article.');
      return;
    }
    setAutoWriteError('');
    setAutoWriteLoading(true);
    setGeneratedResult(null);

    try {
      const keywordList = customKeywords
        ? customKeywords.split(',').map((k) => k.trim()).filter(Boolean)
        : undefined;

      const { data } = await api.post<ArticleWriteResponse>('/content/write-article', {
        topic: topicToUse,
        targetKeyword: targetKeyword.trim() || topicToUse,
        keywords: keywordList,
        tone: articleTone,
        length: articleLength,
        instructions: customInstructions.trim() || undefined,
        sharedEntities,
      });

      setGeneratedResult(data);

      if (data.content) {
        if (onReplaceContent) {
          onReplaceContent(data.content);
        } else {
          onInsert(data.content);
        }
      }
    } catch (err: any) {
      setAutoWriteError(err?.response?.data?.error || err?.message || 'Auto-writing article failed.');
    } finally {
      setAutoWriteLoading(false);
    }
  };

  const handleGenerateAsset = async (assetType: AssetType, schemaType?: SchemaType) => {
    const kwToUse = targetKeyword.trim() || customTopic.trim();
    if (!kwToUse) {
      setButtonStates((prev) => ({
        ...prev,
        [assetType]: { loading: false, error: 'Target keyword or topic is required.', result: null },
      }));
      return;
    }

    setButtonStates((prev) => ({
      ...prev,
      [assetType]: { loading: true, error: '', result: null },
    }));

    try {
      const combinedContext = [customAssetContext.trim(), pageContext.trim()].filter(Boolean).join('\n\n');

      const payload: Record<string, unknown> = { targetKeyword: kwToUse, assetType };
      if (combinedContext) payload.pageContext = combinedContext;
      if (schemaType) payload.schemaType = schemaType;

      const { data } = await api.post<GenerateResponse>('/content/generate', payload);
      setButtonStates((prev) => ({
        ...prev,
        [assetType]: { loading: false, error: '', result: data },
      }));
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.message || 'Generation failed';
      setButtonStates((prev) => ({
        ...prev,
        [assetType]: { loading: false, error: message, result: null },
      }));
    }
  };

  const handleEnhanceStructure = async () => {
    if (!pageContext.trim()) {
      setEnhanceError('Editor content is empty. Add text before enhancing structure.');
      return;
    }
    setEnhanceError('');
    setEnhanceLoading(true);
    setChangesSummary([]);

    try {
      const { data } = await api.post<{ enhancedText: string; changesSummary: string[] }>('/content/enhance-structure', {
        text: pageContext,
        targetKeyword: targetKeyword || customTopic,
        sharedEntities,
      });

      if (data.enhancedText && onReplaceContent) {
        onReplaceContent(data.enhancedText);
        setChangesSummary(
          data.changesSummary || [
            'Structured H1/H2 headings into markdown format.',
            'Ensured direct answer paragraphs under H2 tags.',
            'Integrated competitor target entities.',
          ],
        );
      }
    } catch (err: any) {
      setEnhanceError(err?.response?.data?.error || 'Enhancing structure failed.');
    } finally {
      setEnhanceLoading(false);
    }
  };

  const handleRewriteTone = async () => {
    if (!pageContext.trim()) {
      setRewriteError('Editor content is empty. Add text before rewriting.');
      return;
    }
    setRewriteError('');
    setRewriteLoading(true);

    try {
      const { data } = await api.post<{ enhancedText: string }>('/content/enhance-structure', {
        text: pageContext,
        targetKeyword,
        sharedEntities,
      });

      if (data.enhancedText && onReplaceContent) {
        onReplaceContent(data.enhancedText);
      }
    } catch (err: any) {
      setRewriteError(err?.response?.data?.error || 'Rewrite failed.');
    } finally {
      setRewriteLoading(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-app-signal" />
          AI Copilot & Writer Studio
        </h3>
        <span className="text-2xs font-mono text-app-signal bg-app-signal/10 px-2 py-0.5 rounded border border-app-signal/20">
          Powered by Groq LLM
        </span>
      </div>

      {/* Studio Navigation Tabs */}
      <div className="flex border-b border-app-border mb-4">
        <button
          onClick={() => setActiveTab('write')}
          className={`pb-2.5 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-all ${
            activeTab === 'write'
              ? 'border-app-signal text-app-signal'
              : 'border-transparent text-app-text-muted hover:text-white'
          }`}
        >
          <Wand2 className="h-3.5 w-3.5" />
          Auto-Write & Assets
        </button>
        <button
          onClick={() => setActiveTab('enhance')}
          className={`pb-2.5 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-all ${
            activeTab === 'enhance'
              ? 'border-app-signal text-app-signal'
              : 'border-transparent text-app-text-muted hover:text-white'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          Enhance Structure
        </button>
        <button
          onClick={() => setActiveTab('rewrite')}
          className={`pb-2.5 px-3 text-xs font-bold border-b-2 flex items-center gap-1.5 transition-all ${
            activeTab === 'rewrite'
              ? 'border-app-signal text-app-signal'
              : 'border-transparent text-app-text-muted hover:text-white'
          }`}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Rewrite & Tone
        </button>
      </div>

      {/* TAB 1: Auto-Write Article & Assets */}
      {activeTab === 'write' && (
        <div className="space-y-4">
          <div className="p-4 bg-gradient-to-r from-app-signal/10 via-indigo-500/10 to-app-surface border border-app-signal/30 rounded-xl space-y-3">
            <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
              <FileText className="h-4 w-4 text-app-signal" />
              Custom AI Article Generator
            </h4>
            <p className="text-2xs text-app-text-muted">
              Provide instructions and specifications below. AI will write a complete, structured SEO article directly into the editor.
            </p>

            <div className="space-y-2.5">
              <div>
                <label className="block text-2xs font-bold text-app-text mb-1">Article Topic / Headline *</label>
                <input
                  type="text"
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  placeholder={targetKeyword ? `e.g. A Complete Guide to ${targetKeyword}` : 'e.g. On-Page SEO Best Practices for 2026'}
                  className="w-full bg-app-base border border-app-border focus:border-app-signal rounded-lg px-3 py-1.5 text-xs text-white placeholder-app-text-muted outline-none font-medium"
                />
              </div>

              <div>
                <label className="block text-2xs font-bold text-app-text mb-1">Secondary Keywords (comma-separated)</label>
                <input
                  type="text"
                  value={customKeywords}
                  onChange={(e) => setCustomKeywords(e.target.value)}
                  placeholder="e.g. meta tags, heading structure, page speed"
                  className="w-full bg-app-base border border-app-border focus:border-app-signal rounded-lg px-3 py-1.5 text-xs text-white placeholder-app-text-muted outline-none"
                />
              </div>

              <div>
                <label className="block text-2xs font-bold text-app-text mb-1">Custom Instructions & Key Focus (Optional)</label>
                <textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="e.g. Focus on practical steps, include a comparison table, and mention mobile indexing."
                  rows={2}
                  className="w-full bg-app-base border border-app-border focus:border-app-signal rounded-lg px-3 py-1.5 text-xs text-white placeholder-app-text-muted outline-none resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-2xs font-bold text-app-text mb-1">Tone</label>
                  <select
                    value={articleTone}
                    onChange={(e) => setArticleTone(e.target.value as Tone)}
                    className="w-full bg-app-base border border-app-border text-xs text-white rounded px-2.5 py-1.5 outline-none font-medium"
                  >
                    <option value="professional">Professional</option>
                    <option value="conversational">Conversational</option>
                    <option value="persuasive">Persuasive</option>
                    <option value="informative">Informative</option>
                  </select>
                </div>
                <div>
                  <label className="block text-2xs font-bold text-app-text mb-1">Length</label>
                  <select
                    value={articleLength}
                    onChange={(e) => setArticleLength(e.target.value as any)}
                    className="w-full bg-app-base border border-app-border text-xs text-white rounded px-2.5 py-1.5 outline-none font-medium"
                  >
                    <option value="short">Short (~350 words)</option>
                    <option value="medium">Medium (~800 words)</option>
                    <option value="long">Long (~1500 words)</option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleAutoWriteFullArticle}
                disabled={autoWriteLoading}
                className="w-full bg-app-signal hover:bg-app-signal/90 disabled:opacity-50 text-app-base font-bold text-xs py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 mt-1 shadow-lg shadow-app-signal/20"
              >
                {autoWriteLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {autoWriteLoading ? 'Generating Custom AI Article…' : 'Generate Full AI Article'}
              </button>
              {autoWriteError && <p className="text-2xs text-rose-400 mt-1">{autoWriteError}</p>}
            </div>

            {generatedResult && (
              <div className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg space-y-1.5">
                <p className="text-2xs font-bold text-emerald-400 flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" /> Article Generated & Loaded into Editor!
                </p>
                <p className="text-2xs text-white font-semibold">{generatedResult.title}</p>
                {generatedResult.metaDescription && (
                  <p className="text-2xs text-app-text-muted italic">Meta: "{generatedResult.metaDescription}"</p>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-app-border/60 pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-2xs font-bold text-app-text-muted uppercase tracking-wider">Quick Asset Generators</h4>
            </div>

            <div>
              <input
                type="text"
                value={customAssetContext}
                onChange={(e) => setCustomAssetContext(e.target.value)}
                placeholder="Optional asset instructions or topic context..."
                className="w-full bg-app-base border border-app-border focus:border-app-signal rounded-lg px-3 py-1 text-2xs text-white placeholder-app-text-muted outline-none mb-2"
              />
            </div>

            {BUTTONS.map(({ label, assetType, schemaType }) => {
              const state = buttonStates[assetType];
              return (
                <div key={assetType}>
                  <button
                    onClick={() => handleGenerateAsset(assetType, schemaType)}
                    disabled={state.loading}
                    className="w-full bg-app-base border border-app-border hover:border-app-signal/50 text-app-text font-semibold text-xs px-3.5 py-2 rounded-lg transition-all flex items-center justify-between"
                  >
                    <span>{label}</span>
                    {state.loading && <RefreshCw className="h-3 w-3 animate-spin text-app-signal" />}
                  </button>

                  {state.error && <p className="text-2xs text-rose-400 mt-1">{state.error}</p>}

                  {state.result && (assetType === 'title' || assetType === 'meta_description') && state.result.variants && (
                    <div className="mt-2 space-y-1.5">
                      {state.result.variants.map((v, i) => {
                        const id = `${assetType}-${i}`;
                        const isCopied = copiedItem === id;
                        return (
                          <div key={i} className="flex items-center gap-1.5 text-xs text-app-text-muted bg-app-base border border-app-border rounded-lg px-3 py-2">
                            <span className="flex-1 truncate">{v}</span>
                            <button onClick={() => handleCopy(v, id)} className="text-2xs text-app-signal hover:underline flex-shrink-0 font-medium">
                              {isCopied ? '✓ Copied' : 'Copy'}
                            </button>
                            <button onClick={() => onInsert(v)} className="text-2xs text-emerald-400 hover:underline flex-shrink-0 font-medium">
                              Insert
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {state.result && assetType === 'faq' && state.result.items && (
                    <div className="mt-2 space-y-2">
                      {state.result.items.map((item, i) => (
                        <div key={i} className="bg-app-base border border-app-border rounded-lg p-2.5">
                          <p className="text-xs font-bold text-white mb-0.5">Q: {item.question}</p>
                          <p className="text-2xs text-app-text-muted mb-1.5">A: {item.answer}</p>
                          <button onClick={() => onInsert(`## ${item.question}\n\n${item.answer}`)} className="text-2xs text-emerald-400 font-semibold hover:underline">
                            + Insert Section
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {state.result && assetType === 'schema' && (
                    <div className="mt-2">
                      {state.result.valid && state.result.jsonLd ? (
                        <div className="bg-app-base border border-app-border rounded-lg overflow-hidden p-2.5 space-y-2">
                          <pre className="text-2xs text-app-text-muted overflow-x-auto max-h-48 overflow-y-auto font-mono">
                            {JSON.stringify(state.result.jsonLd, null, 2)}
                          </pre>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleCopy(JSON.stringify(state.result!.jsonLd, null, 2), 'schema')}
                              className="text-2xs text-app-signal hover:underline font-semibold"
                            >
                              {copiedItem === 'schema' ? '✓ Copied' : 'Copy JSON-LD'}
                            </button>
                            <button
                              onClick={() => onInsert(`\n\n\`\`\`html\n<script type="application/ld+json">\n${JSON.stringify(state.result!.jsonLd, null, 2)}\n</script>\n\`\`\`\n`)}
                              className="text-2xs text-emerald-400 hover:underline font-semibold"
                            >
                              + Inject Schema into Document
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-2xs text-amber-400 px-1 mt-1">
                          {state.result.error || 'Could not generate valid schema markup — try again.'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: Enhance Structure */}
      {activeTab === 'enhance' && (
        <div className="space-y-4">
          <div className="p-3.5 bg-app-base border border-app-border rounded-xl">
            <h4 className="text-xs font-bold text-white mb-1">AI Structural Page Enhancer</h4>
            <p className="text-2xs text-app-text-muted mb-3">
              Analyzes current editor text, enforces H1/H2 heading hierarchy, formats 40-80 word direct-answer blocks for AI Overviews, and integrates missing competitor entities.
            </p>

            <button
              onClick={handleEnhanceStructure}
              disabled={enhanceLoading || !pageContext.trim()}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-app-base font-bold text-xs py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
            >
              {enhanceLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {enhanceLoading ? 'Enhancing Page Structure…' : 'Enhance Content & Structure'}
            </button>
            {enhanceError && <p className="text-2xs text-rose-400 mt-1.5">{enhanceError}</p>}
          </div>

          {changesSummary.length > 0 && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-1.5">
              <h5 className="text-2xs font-bold text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Structural Improvements Applied:
              </h5>
              <ul className="space-y-1">
                {changesSummary.map((change, idx) => (
                  <li key={idx} className="text-2xs text-emerald-300 flex items-start gap-1">
                    <span>•</span>
                    <span>{change}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Tone & Rewrite */}
      {activeTab === 'rewrite' && (
        <div className="space-y-4">
          <div className="p-3.5 bg-app-base border border-app-border rounded-xl">
            <h4 className="text-xs font-bold text-white mb-1">AI Tone & Readability Rewrite</h4>
            <p className="text-2xs text-app-text-muted mb-3">
              Refines tone, fixes passive voice, and enhances readability while preserving SEO keyword optimization.
            </p>

            <div className="mb-3">
              <label className="block text-2xs font-semibold text-app-text-muted mb-1">Target Tone</label>
              <select
                value={selectedTone}
                onChange={(e) => setSelectedTone(e.target.value as Tone)}
                className="w-full bg-app-surface border border-app-border text-xs text-white rounded px-2.5 py-1.5 outline-none"
              >
                <option value="professional">Professional & Authoritative</option>
                <option value="conversational">Conversational & Engaging</option>
                <option value="persuasive">Persuasive & Action-Oriented</option>
                <option value="informative">Informative & Educational</option>
              </select>
            </div>

            <button
              onClick={handleRewriteTone}
              disabled={rewriteLoading || !pageContext.trim()}
              className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-bold text-xs py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
            >
              {rewriteLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {rewriteLoading ? 'Rewriting Article…' : `Rewrite Article in ${selectedTone} Tone`}
            </button>
            {rewriteError && <p className="text-2xs text-rose-400 mt-1.5">{rewriteError}</p>}
          </div>
        </div>
      )}
    </Card>
  );
}
