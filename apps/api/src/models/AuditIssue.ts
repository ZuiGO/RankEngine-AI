import { Schema, model, Document, Types } from 'mongoose';

export type AuditIssueSeverity = 'critical' | 'warning' | 'passed';

export interface IAuditIssue extends Document {
  crawlJobId: Types.ObjectId;
  severity: AuditIssueSeverity;
  category: string;
  url: string;
  description: string;
  recommendation: string;
  whyItMatters?: string;
  details?: any[];
}

const AuditIssueSchema = new Schema<IAuditIssue>({
  crawlJobId: {
    type: Schema.Types.ObjectId,
    ref: 'CrawlJob',
    required: true,
  },
  severity: {
    type: String,
    enum: ['critical', 'warning', 'passed'],
    required: true,
  },
  category: {
    type: String,
    required: true,
    trim: true,
  },
  url: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
    trim: true,
  },
  recommendation: {
    type: String,
    required: true,
    trim: true,
  },
  whyItMatters: {
    type: String,
    trim: true,
  },
  details: {
    type: Schema.Types.Mixed,
    default: [],
  },
}, { strict: false });

// Indexes to speed up queries grouping/filtering issues by crawl job and severity
AuditIssueSchema.index({ crawlJobId: 1 });
AuditIssueSchema.index({ crawlJobId: 1, severity: 1 });

export const AuditIssue = model<IAuditIssue>('AuditIssue', AuditIssueSchema);
export default AuditIssue;
