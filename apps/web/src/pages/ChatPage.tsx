import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Send, Bot, User, RefreshCw, ChevronDown, ChevronUp, Layers } from 'lucide-react';
import api from '../lib/api';
import { Card } from '../components/ui';

interface VectorMatch {
  section: string;
  pageUrl: string;
  score: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  vectorMatches?: VectorMatch[];
}

type Section = 'Overview' | 'Pages' | 'Action Items' | 'Content' | 'All';

const SECTIONS: Section[] = ['Overview', 'Pages', 'Action Items', 'Content', 'All'];

const SECTION_HINTS: Record<Section, string> = {
  Overview: 'Ask about overall SEO health, scores, and summary findings.',
  Pages: 'Ask about per-page issues, broken links, and on-page SEO.',
  'Action Items': 'Ask about recommended fixes and their priority.',
  Content: 'Ask about PDFs, videos, images, and extracted content.',
  All: 'Search across all indexed content.',
};

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi! I\'m RankBot, your SEO assistant. Ask me anything about your site\'s SEO performance, strategy, or how to improve your rankings. You can scope your questions to a specific section using the selector below.' },
  ]);
  const [input, setInput] = useState('');
  const [section, setSection] = useState<Section>('Overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedCitations, setExpandedCitations] = useState<Record<number, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMessage = input.trim();
    setInput('');
    setError('');

    const history = messages.slice(1).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const { data } = await api.post(`/projects/${id}/chat`, {
        question: userMessage,
        section,
        history,
      });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer,
          vectorMatches: data.vectorMatches ?? [],
        },
      ]);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to get response');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleCitations = (msgIdx: number) => {
    setExpandedCitations((prev) => ({ ...prev, [msgIdx]: !prev[msgIdx] }));
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <Link to={`/projects/${id}`} className="text-xs text-app-signal hover:text-app-signal/80 font-semibold flex items-center space-x-1">
          <span>← Back to Project</span>
        </Link>
        <span className="text-app-text-muted text-xs">AI Chat Assistant</span>
      </div>

      <div className="flex-shrink-0 mb-3">
        <div className="bg-app-surface border border-app-border rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="h-3.5 w-3.5 text-app-signal" />
            <span className="text-2xs font-semibold text-app-text-muted uppercase tracking-wider">Context Scope</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SECTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`text-2xs px-3 py-1.5 rounded-full border transition-all font-medium ${
                  section === s
                    ? 'bg-app-signal/20 border-app-signal/50 text-app-signal'
                    : 'bg-app-base border-app-border text-app-text-muted hover:border-app-signal/30 hover:text-app-text'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="text-2xs text-app-text-muted mt-2 leading-snug">{SECTION_HINTS[section]}</p>
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-app-border">
          <Bot className="h-5 w-5 text-app-signal" />
          <span className="text-sm font-bold text-white">RankBot</span>
          <span className="ml-auto flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-2xs text-app-text-muted">{section} scope</span>
          </span>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-app-signal/20 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-app-signal" />
                </div>
              )}
              <div className="max-w-[80%] flex flex-col gap-1.5">
                <div
                  className={`rounded-2xl px-4 py-2.5 ${
                    msg.role === 'user'
                      ? 'bg-app-signal/20 text-app-text border border-app-signal/20'
                      : 'bg-app-base border border-app-border text-app-text-muted'
                  }`}
                >
                  <div className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                </div>

                {msg.role === 'assistant' && msg.vectorMatches && msg.vectorMatches.length > 0 && (
                  <div className="ml-1">
                    <button
                      onClick={() => toggleCitations(i)}
                      className="flex items-center gap-1 text-2xs text-app-text-muted hover:text-app-text transition-colors"
                    >
                      {expandedCitations[i] ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {msg.vectorMatches.length} source{msg.vectorMatches.length !== 1 ? 's' : ''} referenced
                    </button>
                    {expandedCitations[i] && (
                      <div className="mt-1.5 space-y-1">
                        {msg.vectorMatches.map((vm, vi) => (
                          <div
                            key={vi}
                            className="flex items-center gap-2 bg-app-surface border border-app-border rounded-lg px-2.5 py-1.5 text-2xs"
                          >
                            <span className="text-app-signal font-semibold shrink-0">[{vm.section}]</span>
                            <span className="text-app-text-muted truncate flex-1">{vm.pageUrl}</span>
                            <span className="shrink-0 text-app-text-muted tabular-nums">
                              {(vm.score * 100).toFixed(0)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-app-surface border border-app-border flex items-center justify-center">
                  <User className="h-4 w-4 text-app-text-muted" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-app-signal/20 flex items-center justify-center">
                <Bot className="h-4 w-4 text-app-signal" />
              </div>
              <div className="bg-app-base border border-app-border rounded-2xl px-4 py-3 flex items-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-app-signal" />
                <span className="text-2xs text-app-text-muted">Searching {section} context…</span>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg">{error}</div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="px-5 py-3 border-t border-app-border">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Ask about ${section === 'All' ? 'anything' : section.toLowerCase()}…`}
              rows={1}
              className="flex-1 bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-app-text-muted outline-none resize-none"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="bg-app-signal hover:bg-app-signal/90 disabled:opacity-50 disabled:cursor-not-allowed text-app-base rounded-lg px-4 flex items-center justify-center transition-all"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="text-2xs text-app-text-muted mt-1.5">Press Enter to send · Shift+Enter for new line</p>
        </div>
      </Card>
    </div>
  );
}
