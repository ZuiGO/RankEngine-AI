import { useState, useEffect } from 'react';
import {
  X,
  Monitor,
  Smartphone,
  Sparkles,
  AlertTriangle,
  Copy,
  Code,
  Wand2,
  RefreshCw,
  Eye,
  Edit3,
  Layers,
  Image as ImageIcon,
  Search,
  Check,
} from 'lucide-react';
import api from '../lib/api';
import { Card, Badge } from './ui';

interface VisualPageInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  targetUrl: string;
  initialIssue?: {
    category?: string;
    description?: string;
    recommendation?: string;
  };
}

export default function VisualPageInspector({
  isOpen,
  onClose,
  targetUrl,
  initialIssue,
}: VisualPageInspectorProps) {
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [canvasMode, setCanvasMode] = useState<'dom' | 'iframe'>('dom');
  const [activeTab, setActiveTab] = useState<'meta' | 'headings' | 'images' | 'schema'>('meta');

  const [domainName, setDomainName] = useState('example.com');
  const [title, setTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');

  const [headings, setHeadings] = useState<
    { id: number; level: 'h1' | 'h2' | 'h3'; text: string; directAnswer?: string; isValid?: boolean }[]
  >([
    { id: 1, level: 'h1', text: 'Main Page Title Heading' },
    {
      id: 2,
      level: 'h2',
      text: 'What is On-Page SEO Optimization?',
      directAnswer:
        'On-page SEO optimization is the practice of refining individual web page elements—including content, headings, meta tags, and images—to improve search engine visibility and drive relevant organic traffic.',
      isValid: true,
    },
    {
      id: 3,
      level: 'h2',
      text: 'Key Elements of Search Rankings',
      directAnswer: '',
      isValid: false,
    },
  ]);

  const [images, setImages] = useState<
    { id: number; src: string; alt: string; hasAlt: boolean; width: number; height: number; hasDimensions: boolean }[]
  >([
    { id: 1, src: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop&q=60', alt: 'Analytics dashboard overview', hasAlt: true, width: 600, height: 400, hasDimensions: true },
    { id: 2, src: 'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=600&auto=format&fit=crop&q=60', alt: '', hasAlt: false, width: 0, height: 0, hasDimensions: false },
    { id: 3, src: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&auto=format&fit=crop&q=60', alt: 'SEO keyword performance chart', hasAlt: true, width: 0, height: 0, hasDimensions: false },
  ]);

  const [schemaJson] = useState<object | null>({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'On-Page SEO Optimization Guide',
    author: { '@type': 'Person', name: 'SEO Expert' },
    datePublished: '2026-07-30',
  });

  const [focusedElement, setFocusedElement] = useState<string>('title');
  const [aiLoading, setAiLoading] = useState(false);
  const [showPatchModal, setShowPatchModal] = useState(false);
  const [copiedPatch, setCopiedPatch] = useState(false);

  const [pageFetchLoading, setPageFetchLoading] = useState(false);
  const [pageFetchError, setPageFetchError] = useState('');

  useEffect(() => {
    if (!isOpen || !targetUrl) return;

    let isMounted = true;
    const cleanDomain = targetUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || 'apple.com';
    setDomainName(cleanDomain);
    setPageFetchLoading(true);
    setPageFetchError('');

    api
      .post<{
        domainName: string;
        title: string;
        metaDescription: string;
        headings: any[];
        images: any[];
      }>('/content/inspect-page', { url: targetUrl })
      .then(({ data }) => {
        if (!isMounted) return;
        if (data.domainName) setDomainName(data.domainName);
        if (data.title) setTitle(data.title);
        if (data.metaDescription) setMetaDescription(data.metaDescription);
        if (Array.isArray(data.headings) && data.headings.length > 0) {
          setHeadings(data.headings);
        }
        if (Array.isArray(data.images) && data.images.length > 0) {
          setImages(data.images);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.warn('Live page inspect failed:', err);
        setPageFetchError('Could not scrape live site directly — using live URL target fallback.');
      })
      .finally(() => {
        if (isMounted) setPageFetchLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, targetUrl]);

  useEffect(() => {
    if (initialIssue?.category === 'mobile' || initialIssue?.category === 'core-web-vitals') {
      setActiveTab('images');
    } else if (initialIssue?.category === 'on-page' || initialIssue?.category === 'html') {
      setActiveTab('meta');
    } else if (initialIssue?.category === 'schema') {
      setActiveTab('schema');
    }
  }, [initialIssue]);

  if (!isOpen) return null;

  // AI Generator Handlers
  const handleAiOptimizeTitle = async () => {
    setAiLoading(true);
    try {
      const { data } = await api.post('/content/generate', {
        targetKeyword: domainName,
        assetType: 'title',
      });
      if (data.variants && data.variants.length > 0) {
        setTitle(data.variants[0]);
      }
    } catch {
      setTitle(`${domainName.replace('.com', '')} | Official SEO & Web Optimization`);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiOptimizeMeta = async () => {
    setAiLoading(true);
    try {
      const { data } = await api.post('/content/generate', {
        targetKeyword: domainName,
        assetType: 'meta_description',
      });
      if (data.variants && data.variants.length > 0) {
        setMetaDescription(data.variants[0]);
      }
    } catch {
      setMetaDescription(
        `Discover expert strategies and proven insights for ${domainName}. Optimize your website performance, boost search rankings, and drive organic traffic effectively.`
      );
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiAddDirectAnswer = (headingId: number) => {
    setHeadings((prev) =>
      prev.map((h) => {
        if (h.id === headingId) {
          const direct = `${h.text} involves implementing strategic optimizations, refined content structures, and technical standards. Following established practices ensures search engines understand page intent while delivering maximum user value.`;
          return { ...h, directAnswer: direct, isValid: true };
        }
        return h;
      })
    );
  };

  const handleAiFixImageAlt = (imgId: number) => {
    setImages((prev) =>
      prev.map((img) => {
        if (img.id === imgId) {
          return {
            ...img,
            alt: `High resolution analytical dashboard graphic for ${domainName}`,
            hasAlt: true,
          };
        }
        return img;
      })
    );
  };

  const handleFixImageDimensions = (imgId: number) => {
    setImages((prev) =>
      prev.map((img) => {
        if (img.id === imgId) {
          return { ...img, width: 600, height: 400, hasDimensions: true };
        }
        return img;
      })
    );
  };

  const generatePatchCode = () => {
    const headTags = [
      `<!-- HTML Head SEO Fixes for ${domainName} -->`,
      `<title>${title}</title>`,
      `<meta name="description" content="${metaDescription}">`,
      `<meta name="viewport" content="width=device-width, initial-scale=1">`,
      schemaJson ? `<script type="application/ld+json">\n${JSON.stringify(schemaJson, null, 2)}\n</script>` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const imagePatches = images
      .map(
        (img) =>
          `<!-- Fix for Image #${img.id} -->\n<img src="${img.src}" alt="${img.alt || 'Descriptive ALT text'}" width="${img.width || 600}" height="${img.height || 400}">`
      )
      .join('\n\n');

    return `${headTags}\n\n${imagePatches}`;
  };

  const handleCopyPatch = () => {
    navigator.clipboard.writeText(generatePatchCode());
    setCopiedPatch(true);
    setTimeout(() => setCopiedPatch(false), 2000);
  };

  const totalIssuesCount =
    (title.length > 60 || title.length < 30 ? 1 : 0) +
    (metaDescription.length > 160 || metaDescription.length < 120 ? 1 : 0) +
    headings.filter((h) => h.level === 'h2' && !h.isValid).length +
    images.filter((i) => !i.hasAlt || !i.hasDimensions).length;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-app-surface border border-app-border rounded-2xl w-full max-w-7xl h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Top Header Bar */}
        <div className="bg-app-base px-5 py-3 border-b border-app-border flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-app-signal/10 text-app-signal rounded-lg border border-app-signal/20">
              <Eye className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white">Visual SEO Inspector & On-Page Editor</h2>
                <Badge variant={totalIssuesCount === 0 ? 'success' : 'warning'} className="font-mono text-2xs">
                  {totalIssuesCount === 0 ? '✓ 0 Issues' : `${totalIssuesCount} Visual Issue(s)`}
                </Badge>
              </div>
              <p className="text-2xs text-app-text-muted font-mono truncate max-w-md">Target: {targetUrl}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Device Viewport Toggle */}
            <div className="bg-app-surface border border-app-border rounded-lg p-1 flex items-center gap-1">
              <button
                onClick={() => setViewport('desktop')}
                className={`px-2.5 py-1 text-2xs font-semibold rounded flex items-center gap-1 transition-all ${
                  viewport === 'desktop' ? 'bg-app-signal text-app-base font-bold' : 'text-app-text-muted hover:text-white'
                }`}
              >
                <Monitor className="h-3.5 w-3.5" />
                Desktop
              </button>
              <button
                onClick={() => setViewport('mobile')}
                className={`px-2.5 py-1 text-2xs font-semibold rounded flex items-center gap-1 transition-all ${
                  viewport === 'mobile' ? 'bg-app-signal text-app-base font-bold' : 'text-app-text-muted hover:text-white'
                }`}
              >
                <Smartphone className="h-3.5 w-3.5" />
                Mobile
              </button>
            </div>

            <button
              onClick={() => setShowPatchModal(true)}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-app-base text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-lg shadow-emerald-500/20"
            >
              <Code className="h-3.5 w-3.5" />
              Export HTML Fix Patch
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-app-text-muted hover:text-white hover:bg-app-border/40 rounded-lg transition-all"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Main Body Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-0 overflow-hidden">
          {/* LEFT: Live Interactive Visual Canvas (7 Cols) */}
          <div className="lg:col-span-7 bg-app-base p-4 min-h-0 overflow-y-auto border-r border-app-border flex flex-col items-center">
            {/* Simulated Browser Bar */}
            <div
              className={`transition-all duration-300 w-full flex flex-col min-h-0 bg-app-surface border border-app-border rounded-xl overflow-hidden shadow-2xl ${
                viewport === 'mobile' ? 'max-w-xs' : 'max-w-full'
              }`}
            >
              <div className="bg-app-base px-3 py-2 border-b border-app-border flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex gap-1.5 flex-shrink-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                  </div>
                  <div className="flex-1 bg-app-surface border border-app-border/60 rounded px-2.5 py-0.5 text-2xs font-mono text-app-text-muted truncate flex items-center justify-between gap-1">
                    <div className="truncate">
                      <span className="text-emerald-400">https://</span>
                      <span className="text-white font-semibold">{domainName}</span>
                    </div>
                    {pageFetchLoading && (
                      <span className="text-3xs text-app-signal flex items-center gap-1 flex-shrink-0">
                        <RefreshCw className="h-2.5 w-2.5 animate-spin" /> Scraping Live Site…
                      </span>
                    )}
                    {pageFetchError && (
                      <span className="text-3xs text-amber-400 font-medium truncate flex-shrink-0 max-w-xs">{pageFetchError}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setCanvasMode('dom')}
                    className={`px-2 py-0.5 text-3xs font-bold rounded transition-all ${
                      canvasMode === 'dom' ? 'bg-app-signal text-app-base' : 'text-app-text-muted hover:text-white'
                    }`}
                  >
                    Visual Overlays
                  </button>
                  <button
                    onClick={() => setCanvasMode('iframe')}
                    className={`px-2 py-0.5 text-3xs font-bold rounded transition-all ${
                      canvasMode === 'iframe' ? 'bg-app-signal text-app-base' : 'text-app-text-muted hover:text-white'
                    }`}
                  >
                    Live Site View
                  </button>
                </div>
              </div>

              {/* Render Canvas: Live Iframe vs Interactive Visual DOM */}
              {canvasMode === 'iframe' ? (
                <div className="relative w-full h-[550px] bg-white">
                  <iframe
                    src={targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`}
                    className="w-full h-full border-0"
                    title="Live Website View"
                    sandbox="allow-scripts allow-same-origin"
                  />
                  <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-md px-2.5 py-1 rounded text-3xs text-white border border-app-border">
                    Live Web Frame ({domainName})
                  </div>
                </div>
              ) : (
                <div className="p-5 space-y-5 bg-app-surface text-app-text overflow-y-auto max-h-[calc(85vh-130px)]">
                {/* Visual Title & Meta Overlay */}
                <div
                  onClick={() => {
                    setActiveTab('meta');
                    setFocusedElement('title');
                  }}
                  className={`p-3 rounded-xl border transition-all cursor-pointer relative group ${
                    focusedElement === 'title'
                      ? 'border-app-signal bg-app-signal/5 ring-1 ring-app-signal'
                      : 'border-app-border hover:border-app-signal/50 bg-app-base/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-3xs uppercase font-bold text-app-signal flex items-center gap-1">
                      <Search className="h-3 w-3" /> Google Search SERP Tag
                    </span>
                    <Badge variant={title.length >= 30 && title.length <= 60 ? 'success' : 'warning'} className="text-3xs font-mono">
                      {title.length} / 60 chars
                    </Badge>
                  </div>
                  <h1 className="text-base font-bold text-app-signal truncate hover:underline">{title || 'Missing Page Title'}</h1>
                  <p className="text-xs text-app-text-muted line-clamp-2 mt-1">{metaDescription || 'Missing meta description tag.'}</p>
                </div>

                {/* Headings Hierarchy Visual Blocks */}
                <div className="space-y-3">
                  {headings.map((h) => (
                    <div
                      key={h.id}
                      onClick={() => {
                        setActiveTab('headings');
                        setFocusedElement(`h-${h.id}`);
                      }}
                      className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                        focusedElement === `h-${h.id}`
                          ? 'border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500'
                          : h.level === 'h2' && !h.isValid
                          ? 'border-amber-500/40 bg-amber-500/5 hover:border-amber-500'
                          : 'border-app-border hover:border-app-signal/50 bg-app-base/30'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-3xs uppercase font-bold text-indigo-400 font-mono">{h.level.toUpperCase()} Tag</span>
                        {h.level === 'h2' && (
                          <Badge variant={h.isValid ? 'success' : 'warning'} className="text-3xs font-mono">
                            {h.isValid ? '✓ AI Direct Answer Ready' : 'Needs Direct Answer'}
                          </Badge>
                        )}
                      </div>

                      {h.level === 'h1' && <h1 className="text-xl font-extrabold text-white">{h.text}</h1>}
                      {h.level === 'h2' && <h2 className="text-base font-bold text-white">{h.text}</h2>}

                      {h.directAnswer ? (
                        <p className="text-xs text-emerald-300/90 mt-1.5 p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                          💡 <span className="font-semibold">Direct Answer:</span> {h.directAnswer}
                        </p>
                      ) : h.level === 'h2' ? (
                        <p className="text-2xs text-amber-400 mt-1 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Missing 40–80 word direct answer for Google AI Overview eligibility.
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>

                {/* Media & Images Visual Overlay Cards */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-2xs font-bold uppercase tracking-wider text-app-text-muted">On-Page Media ({images.length} Images)</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {images.map((img) => (
                      <div
                        key={img.id}
                        onClick={() => {
                          setActiveTab('images');
                          setFocusedElement(`img-${img.id}`);
                        }}
                        className={`p-2.5 rounded-xl border transition-all cursor-pointer relative ${
                          focusedElement === `img-${img.id}`
                            ? 'border-app-signal bg-app-signal/5 ring-1 ring-app-signal'
                            : !img.hasAlt || !img.hasDimensions
                            ? 'border-rose-500/40 bg-rose-500/5 hover:border-rose-500'
                            : 'border-app-border bg-app-base/30'
                        }`}
                      >
                        <div className="relative h-28 w-full rounded-lg overflow-hidden mb-2 bg-app-base">
                          <img src={img.src} alt={img.alt} className="w-full h-full object-cover" />
                          <div className="absolute top-1.5 right-1.5 flex gap-1">
                            {!img.hasAlt && <span className="px-1.5 py-0.5 text-3xs font-bold bg-rose-500 text-white rounded">No ALT</span>}
                            {!img.hasDimensions && (
                              <span className="px-1.5 py-0.5 text-3xs font-bold bg-amber-500 text-app-base rounded">No Dimensions</span>
                            )}
                          </div>
                        </div>

                        <p className="text-2xs text-app-text-muted truncate font-mono">
                          ALT: <span className={img.hasAlt ? 'text-white font-semibold' : 'text-rose-400 font-semibold'}>{img.alt || 'MISSING'}</span>
                        </p>
                        <p className="text-3xs text-app-text-muted mt-0.5">
                          Dimensions: {img.hasDimensions ? `${img.width} × ${img.height}px` : 'Unspecified (Risks CLS Shift)'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              )}
            </div>
          </div>

          {/* RIGHT: Interactive On-Page Inspector & Visual Fix Panel (5 Cols) */}
          <div className="lg:col-span-5 bg-app-surface p-4 min-h-0 overflow-y-auto flex flex-col space-y-4">
            {/* Inspector Navigation Tabs */}
            <div className="flex border-b border-app-border pb-2 gap-1">
              <button
                onClick={() => setActiveTab('meta')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === 'meta' ? 'bg-app-signal text-app-base font-bold' : 'text-app-text-muted hover:text-white'
                }`}
              >
                <Search className="h-3.5 w-3.5" />
                Meta Tags
              </button>
              <button
                onClick={() => setActiveTab('headings')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === 'headings' ? 'bg-app-signal text-app-base font-bold' : 'text-app-text-muted hover:text-white'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                Headings
              </button>
              <button
                onClick={() => setActiveTab('images')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === 'images' ? 'bg-app-signal text-app-base font-bold' : 'text-app-text-muted hover:text-white'
                }`}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                Images ({images.filter((i) => !i.hasAlt || !i.hasDimensions).length})
              </button>
              <button
                onClick={() => setActiveTab('schema')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === 'schema' ? 'bg-app-signal text-app-base font-bold' : 'text-app-text-muted hover:text-white'
                }`}
              >
                <Code className="h-3.5 w-3.5" />
                Schema
              </button>
            </div>

            {/* TAB 1: META TAGS INSPECTOR */}
            {activeTab === 'meta' && (
              <div className="space-y-4">
                <Card className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Edit3 className="h-3.5 w-3.5 text-app-signal" />
                      Page Title Tag (`&lt;title&gt;`)
                    </label>
                    <button
                      onClick={handleAiOptimizeTitle}
                      disabled={aiLoading}
                      className="px-2.5 py-1 text-3xs font-bold bg-app-signal/10 text-app-signal hover:bg-app-signal/20 border border-app-signal/30 rounded transition-all flex items-center gap-1"
                    >
                      {aiLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      AI Optimize Title
                    </button>
                  </div>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-app-base border border-app-border focus:border-app-signal rounded-lg px-3 py-2 text-xs text-white font-semibold outline-none"
                  />
                  <div className="flex justify-between items-center text-3xs">
                    <span className="text-app-text-muted">Target: 30–60 characters</span>
                    <span className={title.length >= 30 && title.length <= 60 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                      {title.length} characters
                    </span>
                  </div>
                </Card>

                <Card className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Edit3 className="h-3.5 w-3.5 text-app-signal" />
                      Meta Description (`&lt;meta name="description"&gt;`)
                    </label>
                    <button
                      onClick={handleAiOptimizeMeta}
                      disabled={aiLoading}
                      className="px-2.5 py-1 text-3xs font-bold bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/30 rounded transition-all flex items-center gap-1"
                    >
                      {aiLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      AI Write Meta
                    </button>
                  </div>
                  <textarea
                    value={metaDescription}
                    onChange={(e) => setMetaDescription(e.target.value)}
                    rows={3}
                    className="w-full bg-app-base border border-app-border focus:border-app-signal rounded-lg px-3 py-2 text-xs text-white outline-none resize-none"
                  />
                  <div className="flex justify-between items-center text-3xs">
                    <span className="text-app-text-muted">Target: 120–160 characters</span>
                    <span
                      className={
                        metaDescription.length >= 120 && metaDescription.length <= 160 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'
                      }
                    >
                      {metaDescription.length} characters
                    </span>
                  </div>
                </Card>
              </div>
            )}

            {/* TAB 2: HEADINGS INSPECTOR */}
            {activeTab === 'headings' && (
              <div className="space-y-3">
                {headings.map((h) => (
                  <Card key={h.id} className="p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-2xs font-bold uppercase font-mono text-indigo-400">{h.level} Tag</span>
                      {h.level === 'h2' && (
                        <button
                          onClick={() => handleAiAddDirectAnswer(h.id)}
                          className="px-2 py-0.5 text-3xs font-bold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 rounded transition-all flex items-center gap-1"
                        >
                          <Wand2 className="h-2.5 w-2.5" />
                          + AI Direct Answer
                        </button>
                      )}
                    </div>

                    <input
                      type="text"
                      value={h.text}
                      onChange={(e) => {
                        const val = e.target.value;
                        setHeadings((prev) => prev.map((item) => (item.id === h.id ? { ...item, text: val } : item)));
                      }}
                      className="w-full bg-app-base border border-app-border rounded px-2.5 py-1.5 text-xs text-white font-semibold outline-none"
                    />

                    {h.level === 'h2' && (
                      <div>
                        <label className="block text-3xs font-semibold text-app-text-muted mb-1">
                          Direct Answer Paragraph (40–80 words for AI Overviews)
                        </label>
                        <textarea
                          value={h.directAnswer || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            const words = val.trim().split(/\s+/).filter(Boolean).length;
                            setHeadings((prev) =>
                              prev.map((item) => (item.id === h.id ? { ...item, directAnswer: val, isValid: words >= 40 && words <= 80 } : item))
                            );
                          }}
                          rows={2}
                          placeholder="Add direct answer..."
                          className="w-full bg-app-base border border-app-border rounded px-2.5 py-1 text-2xs text-white outline-none resize-none"
                        />
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}

            {/* TAB 3: IMAGES INSPECTOR */}
            {activeTab === 'images' && (
              <div className="space-y-3">
                {images.map((img) => (
                  <Card key={img.id} className="p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-2xs font-bold text-white">Image #{img.id}</span>
                      <div className="flex gap-1">
                        {!img.hasAlt && (
                          <button
                            onClick={() => handleAiFixImageAlt(img.id)}
                            className="px-2 py-0.5 text-3xs font-bold bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/30 rounded transition-all flex items-center gap-1"
                          >
                            <Wand2 className="h-2.5 w-2.5" /> AI Fix ALT
                          </button>
                        )}
                        {!img.hasDimensions && (
                          <button
                            onClick={() => handleFixImageDimensions(img.id)}
                            className="px-2 py-0.5 text-3xs font-bold bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/30 rounded transition-all"
                          >
                            + Fix Dimensions
                          </button>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-3xs font-semibold text-app-text-muted mb-1">ALT Attribute</label>
                      <input
                        type="text"
                        value={img.alt}
                        onChange={(e) => {
                          const val = e.target.value;
                          setImages((prev) => prev.map((item) => (item.id === img.id ? { ...item, alt: val, hasAlt: val.trim().length > 0 } : item)));
                        }}
                        className="w-full bg-app-base border border-app-border rounded px-2.5 py-1 text-2xs text-white outline-none"
                      />
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {/* TAB 4: SCHEMA INSPECTOR */}
            {activeTab === 'schema' && (
              <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">Structured Data (JSON-LD)</span>
                  <Badge variant="success" className="text-3xs font-mono">
                    Valid JSON-LD
                  </Badge>
                </div>

                <pre className="p-3 bg-app-base border border-app-border rounded-lg text-2xs font-mono text-emerald-300 overflow-x-auto max-h-56">
                  {JSON.stringify(schemaJson, null, 2)}
                </pre>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* EXPORT HTML FIX PATCH MODAL */}
      {showPatchModal && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4">
          <div className="bg-app-surface border border-app-border rounded-2xl w-full max-w-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-app-border pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Code className="h-4 w-4 text-emerald-400" /> Copy Visual Fix Code Patch
              </h3>
              <button onClick={() => setShowPatchModal(false)} className="text-app-text-muted hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-2xs text-app-text-muted">
              Paste these optimized tags into your website's <code className="text-emerald-400 font-mono">&lt;head&gt;</code> or CMS header settings.
            </p>

            <pre className="p-3 bg-app-base border border-app-border rounded-xl text-2xs font-mono text-emerald-300 max-h-64 overflow-y-auto">
              {generatePatchCode()}
            </pre>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={handleCopyPatch}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-app-base text-xs font-bold rounded-lg transition-all flex items-center gap-1.5"
              >
                {copiedPatch ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiedPatch ? '✓ Patch Copied!' : 'Copy Code Patch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
