import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import api from '../lib/api';
import { Card } from './ui';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  projectId: string;
}

export default function ChatPanel({ projectId }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    const question = input.trim();
    if (!question || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setLoading(true);
    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const { data } = await api.post<{ answer: string }>(`/projects/${projectId}/chat`, { question, history });
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
    <Card className="flex flex-col h-[400px]">
      <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-app-text-muted text-center pt-8">Ask a question about your audit data, rankings, or SEO recommendations.</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${msg.role === 'user' ? 'bg-app-signal text-app-base' : 'bg-app-base border border-app-border text-app-text'}`}>
              <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl px-4 py-2.5 bg-app-base border border-app-border text-app-text-muted">
              <p className="text-xs">...</p>
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
          placeholder="Ask about this project..."
          disabled={loading}
          className="flex-1 bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg px-3 py-2 text-xs text-white placeholder-app-text-muted outline-none disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || loading}
          className="bg-app-signal hover:bg-app-signal/90 disabled:opacity-50 disabled:cursor-not-allowed text-app-base rounded-lg p-2 transition-all"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </Card>
  );
}
