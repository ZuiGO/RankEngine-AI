import { useState } from 'react';
import api from '../lib/api';
import { Card } from './ui';

type AssetType = 'title' | 'meta_description' | 'faq' | 'schema';
type SchemaType = 'FAQPage' | 'Article';

interface GenerateResponse {
  variants?: string[];
  items?: { question: string; answer: string }[];
  jsonLd?: object | null;
  valid?: boolean;
  error?: string;
}

interface ButtonState {
  loading: boolean;
  error: string;
  result: GenerateResponse | null;
}

interface AIWriterPanelProps {
  targetKeyword: string;
  pageContext?: string;
  onInsert: (text: string) => void;
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

export default function AIWriterPanel({ targetKeyword, pageContext, onInsert }: AIWriterPanelProps) {
  const [buttonStates, setButtonStates] = useState<Record<AssetType, ButtonState>>({
    title: { loading: false, error: '', result: null },
    meta_description: { loading: false, error: '', result: null },
    faq: { loading: false, error: '', result: null },
    schema: { loading: false, error: '', result: null },
  });

  const handleGenerate = async (assetType: AssetType, schemaType?: SchemaType) => {
    setButtonStates((prev) => ({
      ...prev,
      [assetType]: { loading: true, error: '', result: null },
    }));

    try {
      const payload: Record<string, unknown> = { targetKeyword, assetType };
      if (pageContext) payload.pageContext = pageContext;
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

  const s = buttonStates;

  return (
    <Card className="p-5">
      <h3 className="text-sm font-bold text-white mb-4">AI Writer</h3>
      <div className="space-y-3">
        {BUTTONS.map(({ label, assetType, schemaType }) => {
          const state = buttonStates[assetType];
          return (
            <div key={assetType}>
              <button
                onClick={() => handleGenerate(assetType, schemaType)}
                disabled={state.loading || !targetKeyword.trim()}
                className="w-full bg-app-signal hover:bg-app-signal/90 disabled:opacity-50 disabled:cursor-not-allowed text-app-base font-semibold text-xs px-4 py-2 rounded-lg transition-all flex items-center justify-center gap-2"
              >
                {state.loading && (
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {state.loading ? 'Generating...' : label}
              </button>

              {state.error && (
                <p className="text-2xs text-rose-400 mt-1.5 px-1">{state.error}</p>
              )}

              {state.result && assetType === 'title' && state.result.variants && (
                <div className="mt-2 space-y-1.5">
                  {state.result.variants.map((v, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-app-text-muted bg-app-base border border-app-border rounded-lg px-3 py-2">
                      <span className="flex-1 truncate">{v}</span>
                      <button onClick={() => copyToClipboard(v)} className="text-2xs text-app-signal hover:text-app-signal/80 font-semibold flex-shrink-0">Copy</button>
                      <button onClick={() => onInsert(v)} className="text-2xs text-emerald-400 hover:text-emerald-300 font-semibold flex-shrink-0">Insert</button>
                    </div>
                  ))}
                </div>
              )}

              {state.result && assetType === 'meta_description' && state.result.variants && (
                <div className="mt-2 space-y-1.5">
                  {state.result.variants.map((v, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-app-text-muted bg-app-base border border-app-border rounded-lg px-3 py-2">
                      <span className="flex-1 truncate">{v}</span>
                      <button onClick={() => copyToClipboard(v)} className="text-2xs text-app-signal hover:text-app-signal/80 font-semibold flex-shrink-0">Copy</button>
                      <button onClick={() => onInsert(v)} className="text-2xs text-emerald-400 hover:text-emerald-300 font-semibold flex-shrink-0">Insert</button>
                    </div>
                  ))}
                </div>
              )}

              {state.result && assetType === 'faq' && state.result.items && (
                <div className="mt-2 space-y-2">
                  {state.result.items.map((item, i) => (
                    <div key={i} className="bg-app-base border border-app-border rounded-lg p-3">
                      <p className="text-xs font-bold text-white mb-1">Q: {item.question}</p>
                      <p className="text-2xs text-app-text-muted mb-2">A: {item.answer}</p>
                      <button
                        onClick={() => onInsert(`## ${item.question}\n\n${item.answer}`)}
                        className="text-2xs text-emerald-400 hover:text-emerald-300 font-semibold"
                      >
                        Insert
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {state.result && assetType === 'schema' && (
                <div className="mt-2">
                  {state.result.valid && state.result.jsonLd ? (
                    <div className="bg-app-base border border-app-border rounded-lg overflow-hidden">
                      <pre className="text-2xs text-app-text-muted p-3 overflow-x-auto max-h-48 overflow-y-auto font-mono">
                        {JSON.stringify(state.result.jsonLd, null, 2)}
                      </pre>
                      <div className="px-3 pb-3">
                        <button
                          onClick={() => copyToClipboard(JSON.stringify(state.result.jsonLd, null, 2))}
                          className="text-2xs text-app-signal hover:text-app-signal/80 font-semibold"
                        >
                          Copy JSON-LD
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-2xs text-amber-400 px-1">
                      {state.result.error || 'Could not generate valid schema markup — try again or write it manually.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
