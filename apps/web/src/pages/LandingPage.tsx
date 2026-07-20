import { Link } from 'react-router-dom';
import { Button } from '../components/ui';

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

/*
 * Social-proof section — testimonials below are placeholder content used
 * for layout and visual structure only. Replace with real customer quotes
 * and attribution before launch.
 */
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
    <div className="min-h-screen bg-slate-950 text-white">
      {/* ── Navbar ─────────────────────────────────────────── */}
      <header className="border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-gradient-to-tr from-indigo-600 to-indigo-500 shadow-lg shadow-indigo-500/30">
              <span className="text-white font-bold text-sm">RE</span>
            </div>
            <span className="font-bold text-lg tracking-tight">RankEngine AI</span>
          </div>
          <nav className="hidden sm:flex items-center gap-6 text-sm text-slate-400">
            <button onClick={() => scrollTo('features')} className="hover:text-white transition-colors">
              Features
            </button>
            <Link to="/pricing" className="hover:text-white transition-colors">
              Pricing
            </Link>
            <button onClick={() => scrollTo('testimonials')} className="hover:text-white transition-colors">
              Testimonials
            </button>
          </nav>
          <div className="flex items-center gap-3">
            <Link
              to="/login"
              className="text-sm text-slate-400 hover:text-white transition-colors hidden sm:inline"
            >
              Sign in
            </Link>
            <Link to="/register">
              <Button>Start Free</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 pt-24 pb-32 md:pt-32 md:pb-40 text-center">
        <div className="inline-flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/30 rounded-full px-4 py-1.5 text-xs font-semibold text-indigo-300 mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
          Built for the AI-search era
        </div>
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight tracking-tight max-w-4xl mx-auto">
          Rank in AI Overviews — not just traditional search
        </h1>
        <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mt-6 leading-relaxed">
          The first SEO platform built for generative search. Site audits, content scoring, keyword
          research, and competitor analysis — all tuned for how AI engines discover and rank content.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-10">
          <Link to="/register" className="w-full sm:w-auto">
            <Button className="w-full sm:w-auto px-8 py-3 text-base shadow-xl shadow-indigo-600/30">
              Start Free
            </Button>
          </Link>
          <Link to="/pricing" className="w-full sm:w-auto">
            <Button variant="secondary" className="w-full sm:w-auto px-8 py-3 text-base">
              See Pricing
            </Button>
          </Link>
        </div>
        <p className="text-xs text-slate-500 mt-6">No credit card required · Free tier includes 3 projects</p>
      </section>

      {/* ── Features ───────────────────────────────────────── */}
      <section id="features" className="max-w-6xl mx-auto px-6 pb-32">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold">Everything you need to win in AI search</h2>
          <p className="text-slate-400 mt-4 max-w-xl mx-auto">
            Six integrated toolkits that work together — because modern SEO isn't just about links and keywords anymore.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 hover:border-slate-700 transition-colors"
            >
              <div className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-indigo-500/10 text-indigo-400 mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                  <path d={f.icon} />
                </svg>
              </div>
              <h3 className="font-semibold text-base mb-2">{f.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{f.benefit}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Social proof (placeholders) ────────────────────── */}
      {/*
        WARNING: All testimonials below are placeholder content.
        Replace with real customer quotes, names, companies, and photos
        before public launch. The structure is ready — just swap the
        PLACEHOLDER_TESTIMONIALS array data.
      */}
      <section id="testimonials" className="max-w-6xl mx-auto px-6 pb-32">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold">Trusted by SEO teams switching to AI-native tools</h2>
          <p className="text-slate-400 mt-4 max-w-xl mx-auto">
            Early adopters are already seeing measurable improvements across organic and generative search channels.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {PLACEHOLDER_TESTIMONIALS.map((t, i) => (
            <div
              key={i}
              className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 flex flex-col"
            >
              {/* Quote icon */}
              <svg className="h-6 w-6 text-indigo-500/40 mb-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311C9.591 11.69 11 13.166 11 15c0 1.967-1.574 3.5-3.5 3.5-1.255 0-2.402-.64-2.917-1.179zM14.583 17.321C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311C19.591 11.69 21 13.166 21 15c0 1.967-1.574 3.5-3.5 3.5-1.255 0-2.402-.64-2.917-1.179z" />
              </svg>
              <blockquote className="text-sm text-slate-300 leading-relaxed flex-1">
                {t.quote}
              </blockquote>
              <div className="mt-4 pt-4 border-t border-slate-800">
                <div className="text-xs font-semibold text-white">{t.name}</div>
                <div className="text-xs text-slate-500">{t.company}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA strip ──────────────────────────────────────── */}
      <section className="border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl md:text-4xl font-bold max-w-2xl mx-auto">
            Ready to see where you stand in AI search?
          </h2>
          <p className="text-slate-400 mt-4 max-w-lg mx-auto">
            Get your first 3 projects free, including full Site Audit and AI Visibility reports.
          </p>
          <div className="mt-8">
            <Link to="/register">
              <Button className="px-8 py-3 text-base shadow-xl shadow-indigo-600/30">
                Start Free — No Credit Card
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="border-t border-slate-800/60">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <div className="inline-flex items-center justify-center h-6 w-6 rounded bg-gradient-to-tr from-indigo-600 to-indigo-500">
              <span className="text-white font-bold text-[10px]">RE</span>
            </div>
            RankEngine AI
          </div>
          <div className="flex items-center gap-6 text-xs text-slate-600">
            <span>&copy; {new Date().getFullYear()} RankEngine AI</span>
            <Link to="/pricing" className="hover:text-slate-400 transition-colors">
              Pricing
            </Link>
            <Link to="/login" className="hover:text-slate-400 transition-colors">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
