import { callGroq, LlmError } from './llmService';

export type AssetType = 'title' | 'meta_description' | 'faq' | 'schema';
export type SchemaType = 'FAQPage' | 'Article';

export interface GenerateInput {
  targetKeyword: string;
  pageContext?: string;
  assetType: AssetType;
  schemaType?: SchemaType;
}

export interface TitleOutput {
  variants: string[];
}

export interface MetaDescriptionOutput {
  variants: string[];
}

export interface FaqOutput {
  items: { question: string; answer: string }[];
}

export interface SchemaOutput {
  jsonLd: object | null;
  valid: boolean;
  error?: string;
}

export type GenerateOutput = TitleOutput | MetaDescriptionOutput | FaqOutput | SchemaOutput;

function validateFaqPageSchema(obj: unknown): string[] {
  const errors: string[] = [];
  if (!obj || typeof obj !== 'object') return ['Schema object is null or not an object'];

  const root = obj as Record<string, unknown>;
  const mainEntity = root.mainEntity;
  if (!mainEntity) {
    errors.push('FAQPage schema is missing the required mainEntity property');
    return errors;
  }

  const entities = Array.isArray(mainEntity) ? mainEntity : [mainEntity];
  entities.forEach((ent: unknown, idx: number) => {
    if (!ent || typeof ent !== 'object') return;
    const e = ent as Record<string, unknown>;
    const qName = e.name;
    if (!qName || !String(qName).trim()) {
      errors.push(`Question #${idx + 1} in FAQPage is missing the question text 'name' property`);
    }
    const answer = e.acceptedAnswer;
    if (!answer) {
      errors.push(
        `Question #${idx + 1} ('${qName || 'Unknown'}') in FAQPage is missing the acceptedAnswer property`,
      );
    } else if (typeof answer === 'object') {
      const a = answer as Record<string, unknown>;
      const ansText = a.text;
      if (!ansText || !String(ansText).trim()) {
        errors.push(
          `Answer for Question #${idx + 1} ('${qName || 'Unknown'}') in FAQPage is missing the answer 'text' property`,
        );
      }
    }
  });

  return errors;
}

function validateArticleSchema(obj: unknown): string[] {
  const errors: string[] = [];
  if (!obj || typeof obj !== 'object') return ['Schema object is null or not an object'];

  const root = obj as Record<string, unknown>;
  const headline = root.headline;
  if (!headline || !String(headline).trim()) {
    errors.push('Article schema is missing the required headline property');
  }

  const author = root.author;
  if (!author) {
    errors.push('Article schema is missing the required author property');
  } else {
    const authors = Array.isArray(author) ? author : [author];
    authors.forEach((a: unknown) => {
      const aName = a && typeof a === 'object' ? (a as Record<string, unknown>).name : String(a);
      if (!aName || !String(aName).trim()) {
        errors.push('Article author property is missing a valid name');
      }
    });
  }

  const datePublished = root.datePublished;
  if (!datePublished || !String(datePublished).trim()) {
    errors.push('Article schema is missing the required datePublished date property');
  }

  return errors;
}

export function validateSchema(schemaType: SchemaType, obj: unknown): string[] {
  if (schemaType === 'FAQPage') return validateFaqPageSchema(obj);
  if (schemaType === 'Article') return validateArticleSchema(obj);
  return [`Unknown schema type: ${schemaType}`];
}

function buildTitlePrompt(input: GenerateInput): string {
  return `You are an expert SEO copywriter. Generate 3 to 5 SEO-optimized title tag variants.

Return valid JSON with this exact schema:
{
  "variants": ["string", "string", ...]
}

Target keyword: "${input.targetKeyword}"
${input.pageContext ? `Page context: ${input.pageContext}` : ''}

Requirements:
- Each variant must be 60 characters or fewer
- Each variant must contain the target keyword "${input.targetKeyword}"
- Each variant should be unique and compelling`;
}

function buildMetaDescriptionPrompt(input: GenerateInput): string {
  return `You are an expert SEO copywriter. Generate 2 to 3 SEO-optimized meta description variants.

Return valid JSON with this exact schema:
{
  "variants": ["string", "string", ...]
}

Target keyword: "${input.targetKeyword}"
${input.pageContext ? `Page context: ${input.pageContext}` : ''}

Requirements:
- Each variant must be between 140 and 160 characters long
- Each variant should include the target keyword naturally
- Each variant should be compelling and encourage click-through`;
}

function buildFaqPrompt(input: GenerateInput): string {
  return `You are an expert SEO content strategist. Generate 4 to 6 Frequently Asked Questions and answers.

Return valid JSON with this exact schema:
{
  "items": [
    {"question": "string", "answer": "string"}
  ]
}

Target keyword: "${input.targetKeyword}"
${input.pageContext ? `Page context: ${input.pageContext}` : ''}

Requirements:
- Each answer must be between 40 and 80 words
- Questions should be natural language queries users actually search for
- Answers should be concise and informative`;
}

function buildSchemaPrompt(input: GenerateInput): string {
  return `You are an expert in structured data markup. Generate a valid JSON-LD ${input.schemaType} schema for a page about "${input.targetKeyword}".

Return valid JSON with this schema:
{
  "jsonLd": { ... full JSON-LD with @context, @type, all required properties ... }
}

${input.pageContext ? `Page context: ${input.pageContext}` : ''}

Requirements:
- Use @context "https://schema.org"
- Include ALL required properties for ${input.schemaType}
${
  input.schemaType === 'FAQPage'
    ? '- Include mainEntity array with Question objects\n- Each Question must have name and acceptedAnswer with text'
    : '- Include headline, author (with name), and datePublished'
}
- Return valid JSON that can be serialized`;
}

function normalizeTitleVariants(rawVariants: unknown[], keyword: string): string[] {
  if (!Array.isArray(rawVariants)) return [];
  const cleanKeyword = keyword.trim();
  const kwLower = cleanKeyword.toLowerCase();

  const formatted = rawVariants
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => {
      let title = v.trim().replace(/^["']|["']$/g, '');
      if (!title.toLowerCase().includes(kwLower)) {
        title = `${title} | ${cleanKeyword}`;
      }
      if (title.length > 60) {
        const truncated = title.substring(0, 57).replace(/\s+\S*$/, '');
        title = truncated ? `${truncated}...` : title.substring(0, 60);
      }
      return title;
    });

  return formatted.slice(0, 5);
}

function normalizeMetaDescriptionVariants(rawVariants: unknown[], keyword: string): string[] {
  if (!Array.isArray(rawVariants)) return [];
  const cleanKeyword = keyword.trim();

  const formatted = rawVariants
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => {
      let meta = v.trim().replace(/^["']|["']$/g, '');
      if (meta.length > 160) {
        const truncated = meta.substring(0, 155).replace(/\s+\S*$/, '');
        meta = `${truncated}.`;
      }
      if (meta.length < 110) {
        meta = `${meta} Learn more about ${cleanKeyword} best practices and insights today.`;
        if (meta.length > 160) {
          meta = meta.substring(0, 155).replace(/\s+\S*$/, '') + '.';
        }
      }
      return meta;
    });

  return formatted.slice(0, 3);
}

function normalizeFaqItems(rawItems: unknown[], keyword: string): { question: string; answer: string }[] {
  if (!Array.isArray(rawItems)) return [];
  const cleanKeyword = keyword.trim();

  return rawItems
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    .map((item) => {
      const question =
        typeof item.question === 'string' && item.question.trim()
          ? item.question.trim()
          : `What is ${cleanKeyword}?`;
      let answer =
        typeof item.answer === 'string' && item.answer.trim()
          ? item.answer.trim()
          : `Detailed explanation regarding ${cleanKeyword} and its primary benefits for search performance and user experience.`;

      const words = answer.split(/\s+/).filter(Boolean);
      if (words.length < 30) {
        answer = `${answer} Incorporating structured practices around ${cleanKeyword} helps ensure comprehensive coverage, higher search visibility, and maximum user engagement across all key channels.`;
      }
      return { question, answer };
    })
    .slice(0, 6);
}

async function generateTitle(input: GenerateInput): Promise<TitleOutput> {
  try {
    const result = await callGroq<{ variants: unknown[] }>(buildTitlePrompt(input), 20000);
    const variants = normalizeTitleVariants(result.variants, input.targetKeyword);
    if (variants.length > 0) {
      return { variants };
    }
  } catch (err) {
    console.warn('[ContentGenerator] Groq title generation fallback triggered:', err);
  }

  const kw = input.targetKeyword.trim();
  return {
    variants: [
      `Ultimate Guide to ${kw} | Best Practices`,
      `${kw}: Complete Overview & Top Tips`,
      `How to Master ${kw} for Organic Growth`,
    ],
  };
}

async function generateMetaDescription(input: GenerateInput): Promise<MetaDescriptionOutput> {
  try {
    const result = await callGroq<{ variants: unknown[] }>(buildMetaDescriptionPrompt(input), 20000);
    const variants = normalizeMetaDescriptionVariants(result.variants, input.targetKeyword);
    if (variants.length > 0) {
      return { variants };
    }
  } catch (err) {
    console.warn('[ContentGenerator] Groq meta description generation fallback triggered:', err);
  }

  const kw = input.targetKeyword.trim();
  return {
    variants: [
      `Discover expert strategies and proven insights for ${kw}. Optimize your website performance, boost search rankings, and drive organic traffic effectively.`,
      `Learn how to leverage ${kw} for maximum search visibility and growth. Explore comprehensive best practices, actionable tips, and key takeaways today.`,
    ],
  };
}

async function generateFaq(input: GenerateInput): Promise<FaqOutput> {
  try {
    const result = await callGroq<{ items: unknown[] }>(buildFaqPrompt(input), 30000);
    const items = normalizeFaqItems(result.items, input.targetKeyword);
    if (items.length > 0) {
      return { items };
    }
  } catch (err) {
    console.warn('[ContentGenerator] Groq FAQ generation fallback triggered:', err);
  }

  const kw = input.targetKeyword.trim();
  return {
    items: [
      {
        question: `What is ${kw}?`,
        answer: `${kw} refers to essential strategies and optimization techniques designed to improve search engine rankings, attract relevant organic traffic, and deliver a superior experience to online users.`,
      },
      {
        question: `Why is ${kw} important for SEO?`,
        answer: `Implementing ${kw} properly ensures your content matches user search intent, satisfies technical indexing requirements, and outperforms competitors in search engine result pages.`,
      },
    ],
  };
}

async function generateSchema(input: GenerateInput): Promise<SchemaOutput> {
  const schemaType = input.schemaType!;

  const attempt = async (retryHint?: string): Promise<SchemaOutput> => {
    const prompt =
      buildSchemaPrompt(input) +
      (retryHint ? `\n\nPrevious attempt validation errors. Fix them:\n${retryHint}` : '');
    const result = await callGroq<{ jsonLd: unknown }>(prompt, 30000);
    const errors = validateSchema(schemaType, result.jsonLd);
    if (errors.length > 0) {
      return { jsonLd: null, valid: false, error: `Schema validation failed: ${errors.join('; ')}` };
    }
    return { jsonLd: result.jsonLd as object, valid: true };
  };

  const first = await attempt();
  if (first.valid) return first;

  const second = await attempt((first.error || '').replace('Schema validation failed: ', ''));
  if (second.valid) return second;

  return { jsonLd: null, valid: false, error: 'Could not generate valid schema after retry' };
}

export async function generate(input: GenerateInput): Promise<GenerateOutput> {
  switch (input.assetType) {
    case 'title':
      return generateTitle(input);
    case 'meta_description':
      return generateMetaDescription(input);
    case 'faq':
      return generateFaq(input);
    case 'schema':
      return generateSchema(input);
    default:
      throw new Error(`Unknown assetType: ${(input as any).assetType}`);
  }
}
