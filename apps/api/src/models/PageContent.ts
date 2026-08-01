import { Schema, model, Document, Types } from 'mongoose';

export type ContentType = 'text' | 'image' | 'video' | 'pdf' | 'docx' | 'pptx' | 'xlsx';
export type ExtractionStatus = 'pending' | 'success' | 'failed' | 'unsupported';

export interface IPageContent extends Document {
  projectId: Types.ObjectId;
  crawlJobId: Types.ObjectId;
  pageUrl: string;
  contentType: ContentType;
  sourceUrl: string;
  altText?: string;
  extractionStatus: ExtractionStatus;
  extractionError?: string;
  storagePath?: string;
  extractedText?: string;
  extractedTables?: Record<string, any>[];
  hasTranscript?: boolean;
  createdAt: Date;
}

const PageContentSchema = new Schema<IPageContent>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    crawlJobId: {
      type: Schema.Types.ObjectId,
      ref: 'CrawlJob',
      required: true,
    },
    pageUrl: {
      type: String,
      required: true,
      trim: true,
    },
    contentType: {
      type: String,
      enum: ['text', 'image', 'video', 'pdf', 'docx', 'pptx', 'xlsx'],
      required: true,
    },
    sourceUrl: {
      type: String,
      required: true,
      trim: true,
    },
    altText: {
      type: String,
      trim: true,
    },
    extractionStatus: {
      type: String,
      enum: ['pending', 'success', 'failed', 'unsupported'],
      default: 'pending',
    },
    extractionError: {
      type: String,
    },
    storagePath: {
      type: String,
    },
    extractedText: {
      type: String,
    },
    extractedTables: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    hasTranscript: {
      type: Boolean,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { strict: false }
);

// Indexes for fast lookup by crawlJobId and pageUrl/contentType
PageContentSchema.index({ crawlJobId: 1 });
PageContentSchema.index({ projectId: 1, crawlJobId: 1 });
PageContentSchema.index({ crawlJobId: 1, contentType: 1 });

export const PageContent = model<IPageContent>('PageContent', PageContentSchema);
export default PageContent;
