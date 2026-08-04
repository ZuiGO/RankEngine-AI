import axios from 'axios';
import mongoose from 'mongoose';
import config from '../config';
import { PageContent } from '../models/PageContent';
import { AuditIssue } from '../models/AuditIssue';
import { CrawlJob } from '../models/CrawlJob';

// ─────────────────────────────────────────────────────────────────────────────
// Embedding Strategy Note
// ─────────────────────────────────────────────────────────────────────────────
// This project's configured LLM provider is Groq (LLM_API_KEY → Groq API).
// Groq does NOT offer an embeddings endpoint as of 2026.
// OpenAI does (text-embedding-3-small), but that would require adding a new
// OPENAI_API_KEY credential not already present in this project.
//
// Decision: use a self-contained deterministic hash-based embedding function
// that requires no new API credential. This produces consistent 384-dimensional
// normalized vectors suitable for cosine similarity search in an in-memory
// fallback and in Qdrant. This is a deliberate trade-off: lower semantic quality
// than a neural model, but zero added credential surface and fully offline-safe.
// Swap `generateEmbedding` for an OpenAI call if an OPENAI_API_KEY is added
// in future rounds.
// ─────────────────────────────────────────────────────────────────────────────

// Chunk parameters — standard practice for RAG pipelines
const CHUNK_SIZE_WORDS = 200;  // target words per chunk
const CHUNK_OVERLAP_WORDS = 40; // overlap between consecutive chunks

export interface VectorDocument {
  id: string;
  projectId: string;
  pageUrl: string;
  contentType: string;
  contentId: string;
  section: 'Overview' | 'Pages' | 'Action Items' | 'Content';
  chunkText: string;
  embedding: number[];
}

export interface VectorSearchResult {
  id: string;
  pageUrl: string;
  contentType: string;
  contentId: string;
  section: string;
  chunkText: string;
  score: number;
}

// In-memory vector store fallback for isolated test/offline environments.
// Maps projectId → array of VectorDocuments. Replaced (not appended) on each
// indexProjectContent call to ensure upsert semantics rather than accumulation.
const inMemoryVectorStore = new Map<string, VectorDocument[]>();

// ─────────────────────────────────────────────────────────────────────────────
// Text Chunking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split a text string into word-based chunks with overlap.
 * Returns an empty array for blank/empty inputs.
 */
export function chunkText(text: string, chunkSize = CHUNK_SIZE_WORDS, overlap = CHUNK_OVERLAP_WORDS): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end >= words.length) break;
    start += chunkSize - overlap;
  }

  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a deterministic normalized vector embedding for a text string.
 * See module-level comment for why this is self-contained rather than API-backed.
 */
export function generateEmbedding(text: string, dimensions = 384): number[] {
  const vector: number[] = new Array(dimensions).fill(0);
  const clean = text.toLowerCase().replace(/[^\w\s]/g, '');
  const words = clean.split(/\s+/).filter(Boolean);

  words.forEach((word) => {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vector[idx] += 1.0;
  });

  // L2 normalize so cosine similarity == dot product
  const mag = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (mag > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] /= mag;
    }
  }

  return vector;
}

/**
 * Compute cosine similarity between two equal-length vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─────────────────────────────────────────────────────────────────────────────
// Stable point ID generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a stable, positive 32-bit integer from a string via FNV-1a hashing.
 * Used to produce Qdrant point IDs that are consistent across re-index runs,
 * so Qdrant's PUT (upsert) overwrites the correct existing points.
 */
export function fnv1a32(str: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // Multiply by FNV prime (32-bit), keep within 32-bit unsigned range
    hash = (Math.imul(hash, 0x01000193) >>> 0);
  }
  // Ensure positive non-zero value (Qdrant requires positive integers)
  return (hash >>> 0) || 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Qdrant helpers
// ─────────────────────────────────────────────────────────────────────────────

async function ensureQdrantCollection(): Promise<boolean> {
  try {
    const base = config.QDRANT_URL.replace(/\/$/, '');
    await axios.put(`${base}/collections/rankengine_vectors`, {
      vectors: { size: 384, distance: 'Cosine' },
    });
    return true;
  } catch {
    return false;
  }
}

async function upsertToQdrant(documents: VectorDocument[]): Promise<void> {
  const base = config.QDRANT_URL.replace(/\/$/, '');
  const points = documents.map((doc) => ({
    // Use a stable hash of the document's ID so upserts overwrite the correct
    // existing Qdrant points on re-index, rather than stomping random ones.
    id: fnv1a32(doc.id),
    vector: doc.embedding,
    payload: {
      id: doc.id,
      projectId: doc.projectId,
      pageUrl: doc.pageUrl,
      contentType: doc.contentType,
      contentId: doc.contentId,
      section: doc.section,
      chunkText: doc.chunkText,
    },
  }));

  // PUT /points is Qdrant's upsert endpoint — safe to call repeatedly
  await axios.put(`${base}/collections/rankengine_vectors/points`, { points });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Index all extracted project text into Qdrant (and in-memory fallback).
 * Text is chunked into ~200-word segments with 40-word overlap before embedding.
 * Re-indexing replaces (upserts) existing documents — no unbounded accumulation.
 *
 * Called automatically after Phase 2 content extraction completes for a crawl.
 */
export async function indexProjectContent(projectId: string): Promise<number> {
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new Error('Invalid project ID');
  }

  const documents: VectorDocument[] = [];

  const latestJob = await CrawlJob.findOne({ projectId, status: 'completed' }).sort({ completedAt: -1 });
  const jobId = latestJob ? latestJob._id : null;

  // 1. AuditIssues — index as Pages & Action Items context
  const auditIssues = jobId
    ? await AuditIssue.find({ crawlJobId: jobId }).lean()
    : [];

  auditIssues.forEach((issue) => {
    const issueId = issue._id.toString();
    const issueText = [
      `${issue.category}: ${issue.description}`,
      issue.whyItMatters ? `Why it matters: ${issue.whyItMatters}` : '',
    ].filter(Boolean).join('. ');

    const issueChunks = chunkText(issueText);
    issueChunks.forEach((chunk, ci) => {
      documents.push({
        id: `issue-${issueId}-chunk-${ci}`,
        projectId,
        pageUrl: issue.url,
        contentType: 'text',
        contentId: issueId,
        section: 'Pages',
        chunkText: chunk,
        embedding: generateEmbedding(chunk),
      });
    });

    const actionText = issue.recommendation
      ? `Recommendation: ${issue.recommendation}`
      : `Action: ${issue.description}`;

    const actionChunks = chunkText(actionText);
    actionChunks.forEach((chunk, ci) => {
      documents.push({
        id: `action-${issueId}-chunk-${ci}`,
        projectId,
        pageUrl: issue.url,
        contentType: 'text',
        contentId: issueId,
        section: 'Action Items',
        chunkText: chunk,
        embedding: generateEmbedding(chunk),
      });
    });
  });

  // 2. PageContent — index extracted text from PDFs, DOCX, PPTX, XLSX, videos
  const pageContents = jobId
    ? await PageContent.find({ crawlJobId: jobId }).lean()
    : await PageContent.find({ projectId }).lean();

  pageContents.forEach((content) => {
    const contentId = content._id.toString();
    const textParts: string[] = [];

    if (content.extractedText && content.extractedText.trim().length > 0) {
      textParts.push(content.extractedText.trim());
    }

    if (content.extractedTables && content.extractedTables.length > 0) {
      const tableSummary = content.extractedTables
        .map((t: any) => `Table "${t.sheetName || 'Sheet'}": columns ${t.headers?.join(', ') ?? '(none)'}`)
        .join('; ');
      textParts.push(`Structured data — ${tableSummary}`);
    }

    if (content.altText && content.altText.trim().length > 0) {
      textParts.push(`Image alt text: ${content.altText.trim()}`);
    }

    if (textParts.length === 0) return; // skip content with nothing to index

    const fullText = textParts.join('\n\n');
    const chunks = chunkText(fullText);

    chunks.forEach((chunk, ci) => {
      documents.push({
        id: `content-${contentId}-chunk-${ci}`,
        projectId,
        pageUrl: content.pageUrl,
        contentType: content.contentType,
        contentId,
        section: 'Content',
        chunkText: chunk,
        embedding: generateEmbedding(chunk),
      });
    });
  });

  // Upsert to Qdrant if available (graceful fallback on connection failure)
  const hasQdrant = await ensureQdrantCollection();
  if (hasQdrant && documents.length > 0) {
    try {
      await upsertToQdrant(documents);
    } catch (err) {
      console.warn('[VectorService] Qdrant upsert warning (falling back to in-memory):', err);
    }
  }

  // Replace (not append) existing in-memory store — ensures upsert semantics
  inMemoryVectorStore.set(projectId, documents);

  return documents.length;
}

/**
 * Search indexed content for a project using cosine similarity.
 * Optionally filter by section. Results are scoped strictly to the given projectId.
 *
 * @param projectId  - project to search within (no cross-project leakage)
 * @param query      - natural language query string
 * @param sectionFilter - optional section scope ('Content', 'Pages', 'Action Items', 'Overview', 'All')
 * @param limit      - max results to return (default 5)
 */
export async function searchProjectContent(
  projectId: string,
  query: string,
  sectionFilter?: string,
  limit = 5,
): Promise<VectorSearchResult[]> {
  const documents = inMemoryVectorStore.get(projectId) ?? [];
  const queryEmbedding = generateEmbedding(query);

  let filtered = documents;
  if (sectionFilter && sectionFilter !== 'Overview' && sectionFilter !== 'All') {
    filtered = documents.filter((d) => d.section.toLowerCase() === sectionFilter.toLowerCase());
  }

  const scored = filtered.map((doc) => ({
    id: doc.id,
    pageUrl: doc.pageUrl,
    contentType: doc.contentType,
    contentId: doc.contentId,
    section: doc.section,
    chunkText: doc.chunkText,
    score: cosineSimilarity(queryEmbedding, doc.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Alias retained for backward-compat with chat.ts (which imports searchProjectVectors).
 */
export const searchProjectVectors = (
  projectId: string,
  query: string,
  sectionFilter?: string,
  limit?: number,
) => searchProjectContent(projectId, query, sectionFilter, limit);
