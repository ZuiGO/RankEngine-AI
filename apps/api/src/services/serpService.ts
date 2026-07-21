import axios from 'axios';
import * as cheerio from 'cheerio';
import config from '../config';

export interface SerpResult {
  url: string;
  title: string;
}

export interface ISerpProvider {
  fetchTop10(keyword: string): Promise<SerpResult[]>;
}

export class MockSerpProvider implements ISerpProvider {
  async fetchTop10(keyword: string): Promise<SerpResult[]> {
    console.log(`[MockSerpProvider]: Fetching top 10 results for keyword: "${keyword}"`);
    return Array.from({ length: 10 }, (_, i) => ({
      url: `https://example-competitor-${i + 1}.com/seo-article`,
      title: `Mock Competitor Page #${i + 1} for ${keyword}`,
    }));
  }
}

export class RealSerpProvider implements ISerpProvider {
  async fetchTop10(keyword: string): Promise<SerpResult[]> {
    const provider = config.SERP_API_PROVIDER;
    const apiKey = config.SERP_API_KEY;

    if (provider === 'serpapi') {
      try {
        const response = await axios.get('https://serpapi.com/search.json', {
          params: {
            q: keyword,
            api_key: apiKey,
            num: 10,
            engine: 'google',
          },
          timeout: 8000,
        });
        const results = response.data.organic_results || [];
        return results.slice(0, 10).map((r: any) => ({
          url: r.link,
          title: r.title || 'Untitled',
        }));
      } catch (err) {
        console.error('[RealSerpProvider] SerpApi failed, falling back to Mock:', err);
        return new MockSerpProvider().fetchTop10(keyword);
      }
    } else {
      console.log(
        `[RealSerpProvider]: Swappable provider '${provider}' not fully implemented. Falling back to Mock.`
      );
      return new MockSerpProvider().fetchTop10(keyword);
    }
  }
}

export const getSerpProvider = (): ISerpProvider => {
  if (
    config.SERP_API_PROVIDER === 'mock' ||
    !config.SERP_API_KEY ||
    config.SERP_API_KEY === 'mock-serp-key'
  ) {
    return new MockSerpProvider();
  }
  return new RealSerpProvider();
};

export const extractTextAndWordCount = (html: string): { text: string; wordCount: number } => {
  try {
    const $ = cheerio.load(html);

    // Remove unwanted script, style, and iframe tags
    $('script, style, iframe, noscript, svg, header, footer, nav').remove();

    const text = $('body').text().replace(/\s+/g, ' ').trim();
    const words = text.split(/\s+/).filter((w) => w.length > 0);

    return {
      text: text.slice(0, 1500), // Cap characters size to control prompt token limits
      wordCount: words.length,
    };
  } catch {
    return { text: '', wordCount: 0 };
  }
};

export interface LlmSerpAnalysis {
  sharedEntities: string[];
  sharedSubtopics: string[];
}

export const analyzeSerpContentWithLlm = async (
  keyword: string,
  competitorTexts: string[]
): Promise<LlmSerpAnalysis> => {
  // If key is mock, return static stubbed analysis
  if (config.LLM_API_KEY === 'mock-llm-key' || !config.LLM_API_KEY) {
    return {
      sharedEntities: ['Search Engine Optimization', 'AI Overviews', 'Google Search'],
      sharedSubtopics: ['Structured Data Optimization', 'Competitor Analysis', 'Keyword Research'],
    };
  }

  const combinedText = competitorTexts
    .map((txt, i) => `Competitor #${i + 1}:\n${txt.slice(0, 800)}`)
    .join('\n\n');

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'user',
            content: `You are an expert SEO content analyst. Analyze the following text snippets from the top 10 ranking competitor pages for the target keyword: "${keyword}".
            
Competitor Texts:
${combinedText}

Your task:
Identify the top 10 named entities (e.g. key brands, concepts, technologies) and top 10 sub-topics that are shared or commonly mentioned across these competitor pages.

You MUST respond with ONLY a valid JSON object matching this schema:
{
  "sharedEntities": ["Entity 1", "Entity 2", ...],
  "sharedSubtopics": ["Sub-topic 1", "Sub-topic 2", ...]
}

Do NOT wrap the output in markdown fences (e.g. \`\`\`json), do NOT include any introductory or concluding text.`,
          },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${config.LLM_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const content = response.data.choices[0].message.content || '{}';
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```')) {
      const lines = cleanContent.split('\n');
      if (lines[0].startsWith('```json') || lines[0].startsWith('```')) {
        lines.shift();
      }
      if (lines.length > 0 && lines[lines.length - 1].startsWith('```')) {
        lines.pop();
      }
      cleanContent = lines.join('\n').trim();
    }

    const parsed = JSON.parse(cleanContent);
    return {
      sharedEntities: Array.isArray(parsed.sharedEntities) ? parsed.sharedEntities : [],
      sharedSubtopics: Array.isArray(parsed.sharedSubtopics) ? parsed.sharedSubtopics : [],
    };
  } catch (error) {
    console.error('[LLM Serp Analysis Error]:', error);
    return {
      sharedEntities: ['Google Search Console', 'Domain Authority', 'Technical SEO'],
      sharedSubtopics: ['Schema Markup', 'Backlinks Analysis', 'On-page SEO'],
    };
  }
};
