import { Schema, model, Document, Types } from 'mongoose';

export type AuditSchedule = 'manual' | 'daily' | 'weekly';

export interface ISuggestedKeyword {
  keyword: string;
  dismissed: boolean;
  source: string;
  createdAt: Date;
}

export interface IProject extends Document {
  name: string;
  ownerId: Types.ObjectId;
  domain: string;
  stagingDomain?: string;
  auditSchedule: AuditSchedule;
  suggestedKeywords: ISuggestedKeyword[];
  createdAt: Date;
  deletedAt?: Date | null;
}

const SuggestedKeywordSchema = new Schema<ISuggestedKeyword>({
  keyword: { type: String, required: true, trim: true },
  dismissed: { type: Boolean, default: false },
  source: { type: String, default: 'audit' },
  createdAt: { type: Date, default: Date.now },
});

const ProjectSchema = new Schema<IProject>({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  ownerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  domain: {
    type: String,
    required: true,
    trim: true,
  },
  stagingDomain: {
    type: String,
    trim: true,
  },
  auditSchedule: {
    type: String,
    enum: ['manual', 'daily', 'weekly'],
    default: 'manual',
  },
  suggestedKeywords: {
    type: [SuggestedKeywordSchema],
    default: [],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  deletedAt: {
    type: Date,
    default: null,
  },
});

// Index to quickly fetch all active projects owned by a specific user
ProjectSchema.index({ ownerId: 1, deletedAt: 1 });

export const Project = model<IProject>('Project', ProjectSchema);
export default Project;
