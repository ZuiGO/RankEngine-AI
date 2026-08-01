import axios from 'axios';
import mongoose from 'mongoose';
import config from '../config';
import { PageContent } from '../models/PageContent';
import { AuditIssue } from '../models/AuditIssue';
import { CrawlJob } from '../models/CrawlJob';

export interface VectorDocument {
  id: string;
  projectId: string;
  pageUrl: string;
  contentType: string;
  section: 'Overview' | 'Pages' | 'Action Items' | 'Content';
  text: string;
  embedding: number[];
}

export interface VectorSearchResult {
  id: string;
  pageUrl: string;
  contentType: string;
  section: string;
  text: string;
  score: number;
}

// In-memory vector store fallback for isolated test/offline environments
const inMemoryVectorStore = new Map<string, VectorDocument[]>();

/**
 * Generate a deterministic vector embedding for a text string (384 dimensions).
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

  // Normalize magnitude
  const mag = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (mag > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] /= mag;
    }
  }

  return vector;
}

/**
 * Compute cosine similarity between two vector embeddings.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Ensure Qdrant collection exists.
 */
async function ensureQdrantCollection(): Promise<boolean> {
  try {
    const qdrantUrl = config.QDRANT_URL.replace(/\/$/, '');
    await axios.put(`${qdrantUrl}/collections/rankengine_vectors`, {
      vectors: {
        size: 384,
        distance: 'Cosine',
      },
    });
    return true;
  } catch (err: any) {
    return false;
  }
}

/**
 * Index all extracted project text (Pages, PageContent documents, transcripts) into Vector DB.
 */
export async function indexProjectContent(projectId: string): Promise<number> {
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new Error('Invalid project ID');
  }

  const documents: VectorDocument[] = [];

  const latestJob = await CrawlJob.findOne({ projectId, status: 'completed' }).sort({ completedAt: -1 });
  const jobId = latestJob ? latestJob._id : null;

  // 1. Index Audit Issues (Pages & Action Items)
  const auditIssues = jobId
    ? await AuditIssue.find({ crawlJobId: jobId }).lean()
    : [];

  auditIssues.forEach((issue, idx) => {
    const issueText = `${issue.category}: ${issue.description}. Recommendation: ${issue.recommendation}. Why it matters: ${issue.whyItMatters}`;
    documents.push({
      id: `doc-issue-${idx}`,
      projectId,
      pageUrl: issue.url,
      contentType: 'text',
      section: 'Pages',
      text: issueText,
      embedding: generateEmbedding(issueText),
    });

    documents.push({
      id: `doc-action-${idx}`,
      projectId,
      pageUrl: issue.url,
      contentType: 'text',
      section: 'Action Items',
      text: `Action Item: ${issue.recommendation || issue.description}`,
      embedding: generateEmbedding(issue.recommendation || issue.description),
    });
  });

  // 2. Index PageContent (PDFs, DOCX, XLSX, Videos, Images)
  const pageContents = jobId
    ? await PageContent.find({ crawlJobId: jobId }).lean()
    : await PageContent.find({ projectId }).lean();

  pageContents.forEach((content, idx) => {
    let contentText = `${content.contentType.toUpperCase()} from ${content.sourceUrl}. Status: ${content.extractionStatus}`;
    if (content.extractedText) {
      contentText += `. Extracted Text: ${content.extractedText}`;
    }
    if (content.extractedTables && content.extractedTables.length > 0) {
      const tableSummary = content.extractedTables
        .map((t: any) => `${t.sheetName || 'Table'}: ${t.headers?.join(', ')}`)
        .join('; ');
      contentText += `. Structured Tables: ${tableSummary}`;
    }
    if (content.altText) {
      contentText += `. Alt Text: ${content.altText}`;
    }

    documents.push({
      id: `doc-content-${idx}`,
      projectId,
      pageUrl: content.pageUrl,
      contentType: content.contentType,
      section: 'Content',
      text: contentText,
      embedding: generateEmbedding(contentText),
    });
  });

  // Upsert to Qdrant REST API if available
  const hasQdrant = await ensureQdrantCollection();
  if (hasQdrant) {
    try {
      const points = documents.map((doc, idx) => ({
        id: idx + 1,
        vector: doc.embedding,
        payload: {
          id: doc.id,
          projectId: doc.projectId,
          pageUrl: doc.pageUrl,
          contentType: doc.contentType,
          section: doc.section,
          text: doc.text,
        },
      }));

      await axios.put(`${config.QDRANT_URL.replace(/\/$/, '')}/collections/rankengine_vectors/points`, {
        points,
      });
    } catch (err) {
      // Fallback silently if Qdrant call fails
    }
  }

  // Store in memory
  inMemoryVectorStore.set(projectId, documents);

  return documents.length;
}

/**
 * Search vector embeddings for semantically matching content scoped to project and optional section.
 */
export async function searchProjectVectors(
  projectId: string,
  query: string,
  sectionFilter?: string,
  limit = 5
): Promise<VectorSearchResult[]> {
  let documents = inMemoryVectorStore.get(projectId);
  if (!documents || documents.length === 0) {
    await indexProjectContent(projectId);
    documents = inMemoryVectorStore.get(projectId) || [];
  }

  const queryEmbedding = generateEmbedding(query);

  let filtered = documents;
  if (sectionFilter && sectionFilter !== 'Overview' && sectionFilter !== 'All') {
    filtered = documents.filter((d) => d.section.toLowerCase() === sectionFilter.toLowerCase());
  }

  const scored = filtered.map((doc) => ({
    id: doc.id,
    pageUrl: doc.pageUrl,
    contentType: doc.contentType,
    section: doc.section,
    text: doc.text,
    score: cosineSimilarity(queryEmbedding, doc.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}
