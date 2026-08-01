import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles } from 'lucide-react';
import api from '../lib/api';
import { Card } from './ui';

export type ChatSection = 'Overview' | 'Pages' | 'Action Items' | 'Content' | 'All';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  section?: ChatSection;
}

interface ChatPanelProps {
  projectId: string;
  activeSection?: ChatSection;
}

const SECTIONS: ChatSection[] = ['Overview', 'Pages', 'Action Items', 'Content', 'All'];

export default function ChatPanel({ projectId, activeSection = 'Overview' }: ChatPanelProps) {
  const [selectedSection, setSelectedSection] = useState<ChatSection>(activeSection);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeSection) {
      setSelectedSection(activeSection);
    }
  }, [activeSection]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    const question = input.trim();
    if (!question || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: question, section: selectedSection }]);
    setLoading(true);
    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const { data } = await api.post<{ answer: string }>(`/projects/${projectId}/chat`, {
        question,
        section: selectedSection,
        history,
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer }]);
    } catch (err: any) {
      const errorMsg = err?.response?.data?.error || err?.message || 'Request failed';
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${errorMsg}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Card className="flex flex-col h-[440px]">
      {/* Section Context Tabs */}
      <div className="border-b border-app-border px-4 py-2.5 bg-app-surface/60 flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-1.5 min-w-max">
          <Sparkles className="h-3.5 w-3.5 text-app-signal" />
          <span className="text-2xs font-semibold text-app-text-muted uppercase tracking-wider">Context Scope:</span>
        </div>
        <div className="flex items-center gap-1 min-w-max">
          {SECTIONS.map((sec) => (
            <button
              key={sec}
              onClick={() => setSelectedSection(sec)}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-all ${
                selectedSection === sec
                  ? 'bg-app-signal text-app-base font-semibold shadow-sm'
                  : 'text-app-text-muted hover:text-white hover:bg-app-base/50'
              }`}
            >
              {sec}
            </button>
          ))}
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center pt-8 space-y-2">
            <p className="text-xs text-app-text-muted">
              Ask a question about your audit findings, vector-extracted content, or recommendations.
            </p>
            <p className="text-2xs text-app-signal font-mono">
              Scoped to active section: <strong>{selectedSection}</strong>
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 space-y-1 ${
                msg.role === 'user'
                  ? 'bg-app-signal text-app-base font-medium'
                  : 'bg-app-base border border-app-border text-app-text'
              }`}
            >
              {msg.section && msg.role === 'user' && (
                <div className="flex justify-end">
                  <span className="text-[9px] uppercase font-mono px-1.5 py-0.2 rounded bg-app-base/20 text-app-base font-bold">
                    {msg.section}
                  </span>
                </div>
              )}
              <p className="text-xs whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl px-4 py-2.5 bg-app-base border border-app-border text-app-text-muted">
              <p className="text-xs animate-pulse">Searching vector database & generating response...</p>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-app-border p-3 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Ask about ${selectedSection}...`}
          disabled={loading}
          className="flex-1 bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3 py-2 text-xs text-white placeholder-app-text-muted outline-none disabled:opacity-50"
        />
        <button
          data-testid="send-chat-btn"
          onClick={handleSend}
          disabled={!input.trim() || loading}
          className="bg-app-signal hover:bg-app-signal/90 disabled:opacity-50 disabled:cursor-not-allowed text-app-base rounded-lg p-2 transition-all shadow-md shadow-app-signal/20"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </Card>
  );
}
