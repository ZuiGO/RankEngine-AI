import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Send, Bot, User, RefreshCw } from 'lucide-react';
import api from '../lib/api';
import { Card } from '../components/ui';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Hi! I\'m RankBot, your SEO assistant. Ask me anything about your site\'s SEO performance, strategy, or how to improve your rankings.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [suggestedFollowUps, setSuggestedFollowUps] = useState<string[]>([]);
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
    setSuggestedFollowUps([]);

    try {
      const { data } = await api.post(`/projects/${id}/chat`, {
        message: userMessage,
        history,
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      setSuggestedFollowUps(data.suggestedFollowUps || []);
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

  const clickFollowUp = (q: string) => {
    setInput(q);
    inputRef.current?.focus();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <Link to={`/projects/${id}`} className="text-xs text-app-signal hover:text-app-signal/80 font-semibold flex items-center space-x-1">
          <span>← Back to Project</span>
        </Link>
        <span className="text-app-text-muted text-xs">AI Chat Assistant</span>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-app-border">
          <Bot className="h-5 w-5 text-app-signal" />
          <span className="text-sm font-bold text-white">RankBot</span>
          <span className="text-2xs text-app-text-muted ml-auto">SEO Assistant</span>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-app-signal/20 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-app-signal" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                  msg.role === 'user'
                    ? 'bg-app-signal/20 text-app-text border border-app-signal/20'
                    : 'bg-app-base border border-app-border text-app-text-muted'
                }`}
              >
                <div className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</div>
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
              <div className="bg-app-base border border-app-border rounded-2xl px-4 py-3">
                <RefreshCw className="h-4 w-4 animate-spin text-app-signal" />
              </div>
            </div>
          )}

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg">{error}</div>
          )}

          {suggestedFollowUps.length > 0 && !loading && (
            <div className="flex flex-wrap gap-2 pt-2">
              {suggestedFollowUps.map((q, i) => (
                <button
                  key={i}
                  onClick={() => clickFollowUp(q)}
                  className="text-2xs px-3 py-1.5 rounded-full border border-app-border bg-app-base text-app-text-muted hover:text-app-text hover:bg-app-surface transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
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
              placeholder="Ask about SEO, content, rankings..."
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
          <p className="text-2xs text-app-text-muted mt-1.5">Press Enter to send, Shift+Enter for new line</p>
        </div>
      </Card>
    </div>
  );
}
