import { Schema, model, Document, Types } from 'mongoose';

export type CrawlJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type CrawlJobType = 'crawl' | 'migration-check';

export interface ICrawlJob extends Document {
  projectId: Types.ObjectId;
  status: CrawlJobStatus;
  type: CrawlJobType;
  startedAt?: Date;
  completedAt?: Date;
  pageCount: number;
  rawResultsRef?: string;
  errorMessage?: string;
  healthScore?: number;
}

const CrawlJobSchema = new Schema<ICrawlJob>({
  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
  },
  status: {
    type: String,
    enum: ['queued', 'running', 'completed', 'failed'],
    required: true,
    default: 'queued',
  },
  type: {
    type: String,
    enum: ['crawl', 'migration-check'],
    default: 'crawl',
  },
  startedAt: {
    type: Date,
  },
  completedAt: {
    type: Date,
  },
  pageCount: {
    type: Number,
    default: 0,
  },
  rawResultsRef: {
    type: String,
    trim: true,
  },
  errorMessage: {
    type: String,
    trim: true,
  },
  healthScore: {
    type: Number,
    min: 0,
    max: 100,
  },
});

// Indexes: compound on projectId + status, and single index on status
CrawlJobSchema.index({ projectId: 1, status: 1 });
CrawlJobSchema.index({ status: 1 });

export const CrawlJob = model<ICrawlJob>('CrawlJob', CrawlJobSchema);
export default CrawlJob;
