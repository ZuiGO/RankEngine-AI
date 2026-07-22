import axios from 'axios';
import config from '../config';

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

export async function callGroq<T>(prompt: string, timeoutMs = 30000): Promise<T> {
  if (!config.LLM_API_KEY || config.LLM_API_KEY === 'mock-llm-key') {
    throw new LlmError('LLM_API_KEY not configured');
  }

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    },
    {
      headers: {
        Authorization: `Bearer ${config.LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs,
    }
  );

  let content = response.data.choices[0]?.message?.content;
  if (!content) {
    throw new LlmError('Empty LLM response');
  }

  let cleanContent = content.trim();
  if (cleanContent.startsWith('```')) {
    const lines = cleanContent.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines.length > 0 && lines[lines.length - 1].startsWith('```')) lines.pop();
    cleanContent = lines.join('\n').trim();
  }

  try {
    return JSON.parse(cleanContent) as T;
  } catch {
    throw new LlmError('Failed to parse LLM response as JSON');
  }
}
