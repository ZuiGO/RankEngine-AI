import { Link } from 'react-router-dom';
import { Button } from '../components/ui';
import { PageTransition } from '../components/PageTransition';

const FEATURES = [
  {
    title: 'Site Audit',
    benefit: 'Catch technical SEO issues before they impact rankings — indexation, Core Web Vitals, schema validation, and migration checks in one pass.',
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  },
  {
    title: 'Content Optimization',
    benefit: 'Write content that AI engines rank. Get real-time grades, keyword gap scores, and actionable suggestions inside a built-in editor.',
    icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  },
  {
    title: 'Keyword Research',
    benefit: 'Discover high-opportunity keywords your competitors miss — powered by search volume, AI Overview appearance, and SERP feature data.',
    icon: 'M7 11.5V14m2-6.5V14m4-3V14m2-5.5V14M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z',
  },
  {
    title: 'Backlink Analysis',
    benefit: 'Monitor your full link profile — new and lost backlinks, anchor text distribution, domain authority trends, and competitor link gaps.',
    icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  },
  {
    title: 'AI Visibility',
    benefit: 'Track exactly how often your brand appears in AI Overviews, Perplexity, and other generative search surfaces — not just traditional SERPs.',
    icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  },
  {
    title: 'Competitor Analysis',
    benefit: 'See exactly which keywords competitors rank for and why. Compare domain authority, content quality, and AI visibility side by side.',
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  },
];

const PLACEHOLDER_TESTIMONIALS = [
  {
    quote: 'We went from zero AI Overview appearances to ranking in 40% of relevant queries within two months. RankEngine caught issues our old toolset missed entirely.',
    name: 'Director of SEO',
    company: 'Large B2B SaaS brand (placeholder)',
  },
  {
    quote: 'The content editor alone saves my team hours per article. The AI grading actually matches what we see in rankings — we use it before every publish.',
    name: 'Head of Content',
    company: 'Mid-market e-commerce (placeholder)',
  },
  {
    quote: 'Competitor analysis is the feature I didn\'t know I needed. We found three high-volume keyword gaps in our first week that became our top-performing content.',
    name: 'SEO Manager',
    company: 'Agency (placeholder)',
  },
];

export default function LandingPage() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <PageTransition>
      <div className="min-h-screen bg-app-base text-app-text">
      {/* ── Navbar ─────────────────────────────────────────── */}
      <header className="border-b border-app-border/60 bg-app-base/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal rounded-lg">
            <div className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-gradient-to-br from-app-signal/30 to-app-signal/10 border border-app-signal/20">
              <span className="text-app-signal font-bold text-sm">RE</span>
            </div>
            <span className="font-bold text-lg tracking-tight font-display text-white">RankEngine <span className="text-app-signal">AI</span></span>
          </Link>
          <nav className="hidden sm:flex items-center gap-6 text-sm text-app-text-muted">
            <button
              onClick={() => scrollTo('features')}
              className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal rounded px-1"
            >
              Features
            </button>
            <button
              onClick={() => scrollTo('testimonials')}
              className="hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal rounded px-1"
            >
              Testimonials
            </button>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal rounded-lg">
              <Button glow="signal">Go to Dashboard</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-24 md:pt-24 md:pb-32">
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">

          {/* Text side */}
          <div className="flex-1 min-w-0 text-center lg:text-left">
            <div className="hero-stagger-1 inline-flex items-center gap-2 bg-app-signal/10 border border-app-signal/20 rounded-full px-4 py-1.5 text-xs font-semibold text-app-signal mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-app-signal" />
              Built for the AI-search era
            </div>
            <h1 className="hero-stagger-2 text-[clamp(2rem,5vw,3.5rem)] font-bold leading-[1.1] tracking-tight font-display text-white max-w-2xl">
              Rank in AI Overviews<span className="text-app-text-muted">, </span>not just traditional search
            </h1>
            <p className="hero-stagger-3 text-base md:text-lg text-app-text-muted max-w-lg mx-auto lg:mx-0 mt-5 leading-relaxed">
              The first SEO platform built for generative search. Site audits, AI Visibility
              tracking, and content scoring — tuned for how AI engines discover and rank content.
            </p>
            <div className="hero-stagger-4 flex flex-col sm:flex-row items-center gap-4 mt-8">
              <Link to="/dashboard" className="w-full sm:w-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal rounded-lg">
                <Button glow="citation" className="w-full sm:w-auto px-8 py-3 text-base shadow-xl shadow-app-citation/15">
                  Go to Dashboard
                </Button>
              </Link>
            </div>
          </div>

          {/* Scan visual card */}
          <div className="hero-stagger-5 w-full max-w-lg lg:max-w-[480px] shrink-0">
            <div className="relative bg-app-surface border border-app-border rounded-2xl overflow-hidden shadow-2xl shadow-black/60">
              <div className="hero-scan-beam" aria-hidden="true" />

              {/* Card header — browser chrome mock */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-app-border bg-app-base/40">
                <div className="flex gap-1.5" aria-hidden="true">
                  <div className="h-2.5 w-2.5 rounded-full bg-rose-500/50" />
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-500/50" />
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/50" />
                </div>
                <div className="flex-1 text-center text-[11px] text-app-text-muted font-mono truncate select-none">
                  example.com &rsaquo; blog &rsaquo; ai-seo-strategy
                </div>
                <div className="h-2 w-2 rounded-full bg-app-signal/40" aria-hidden="true" />
              </div>

              {/* Scan preview content */}
              <div className="relative p-5 pb-4 space-y-3">
                <div className="flex items-center gap-2 text-xs text-app-text-muted mb-3">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span className="font-medium uppercase tracking-wider text-[10px]">AI Visibility Scan</span>
                </div>

                <div className="space-y-2.5">
                  <div className="h-2.5 w-full bg-app-text-muted/10 rounded" />
                  <div className="h-2.5 w-3/4 bg-app-text-muted/10 rounded" />
                  <div className="h-2.5 w-5/6 bg-app-text-muted/10 rounded" />
                  <div className="h-2.5 w-2/3 bg-app-text-muted/10 rounded" />
                </div>

                {/* Highlighted phrase */}
                <div className="flex flex-wrap items-baseline gap-x-1.5 py-2 px-2.5 -mx-2.5 rounded-lg bg-app-surface-raised/60 border border-app-border/40 text-sm">
                  <span className="text-app-text-muted text-xs">Content that</span>
                  <span className="hero-phrase-glow font-semibold text-app-signal">&ldquo;ranks in AI Overviews&rdquo;</span>
                  <span className="text-app-text-muted text-xs">requires structured data and citation-ready formatting.</span>
                </div>

                <div className="space-y-2.5">
                  <div className="h-2.5 w-full bg-app-text-muted/10 rounded" />
                  <div className="h-2.5 w-4/5 bg-app-text-muted/10 rounded" />
                  <div className="h-2.5 w-3/5 bg-app-text-muted/10 rounded" />
                </div>

                {/* Score bar */}
                <div className="mt-4 pt-3 border-t border-app-border flex items-center justify-between">
                  <span className="text-[11px] text-app-text-muted font-medium">AI Visibility Score</span>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-[3px]">
                      {[...Array(10)].map((_, i) => (
                        <div
                          key={i}
                          className={`h-2 w-2 rounded-sm ${i < 8 ? 'bg-app-signal' : 'bg-app-border'}`}
                        />
                      ))}
                    </div>
                    <span className="text-base font-bold font-display text-app-signal tabular-nums">84</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────── */}
      <section id="features" className="max-w-6xl mx-auto px-6 pb-28">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold font-display text-white">Everything you need to win in AI search</h2>
          <p className="text-app-text-muted mt-4 max-w-xl mx-auto text-base">
            Six integrated toolkits that work together — because modern SEO isn't just about links and keywords anymore.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-app-surface border border-app-border rounded-2xl p-6 hover:border-app-signal/20 transition-colors"
            >
              <div className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-app-signal/10 text-app-signal mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                  <path d={f.icon} />
                </svg>
              </div>
              <h3 className="font-semibold text-base text-white mb-2">{f.title}</h3>
              <p className="text-sm text-app-text-muted leading-relaxed">{f.benefit}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Social proof (placeholders) ────────────────────── */}
      <section id="testimonials" className="max-w-6xl mx-auto px-6 pb-28">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold font-display text-white">Trusted by SEO teams switching to AI-native tools</h2>
          <p className="text-app-text-muted mt-4 max-w-xl mx-auto text-base">
            Early adopters are already seeing measurable improvements across organic and generative search channels.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {PLACEHOLDER_TESTIMONIALS.map((t, i) => (
            <div
              key={i}
              className="bg-app-surface border border-app-border rounded-2xl p-6 flex flex-col"
            >
              <svg className="h-6 w-6 text-app-signal/30 mb-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311C9.591 11.69 11 13.166 11 15c0 1.967-1.574 3.5-3.5 3.5-1.255 0-2.402-.64-2.917-1.179zM14.583 17.321C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311C19.591 11.69 21 13.166 21 15c0 1.967-1.574 3.5-3.5 3.5-1.255 0-2.402-.64-2.917-1.179z" />
              </svg>
              <blockquote className="text-sm text-app-text leading-relaxed flex-1">
                {t.quote}
              </blockquote>
              <div className="mt-4 pt-4 border-t border-app-border">
                <div className="text-xs font-semibold text-white">{t.name}</div>
                <div className="text-xs text-app-text-muted">{t.company}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA strip ──────────────────────────────────────── */}
      <section className="border-t border-app-border">
        <div className="max-w-6xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl md:text-4xl font-bold font-display text-white max-w-2xl mx-auto">
            Ready to see where you stand in AI search?
          </h2>
          <div className="mt-8">
            <Link to="/dashboard" className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-signal rounded-lg inline-block">
              <Button glow="citation" className="px-8 py-3 text-base shadow-xl shadow-app-citation/15">
                Go to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="border-t border-app-border/60">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-app-text-muted">
            <div className="inline-flex items-center justify-center h-6 w-6 rounded bg-app-signal/20">
              <span className="text-app-signal font-bold text-[10px]">RE</span>
            </div>
            RankEngine AI
          </div>
          <div className="text-xs text-app-text-muted/60">
            &copy; {new Date().getFullYear()} RankEngine AI
          </div>
        </div>
      </footer>
      </div>
    </PageTransition>
  );
}
