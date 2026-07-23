import { Schema, model, Document } from 'mongoose';

export type AuditSchedule = 'manual' | 'daily' | 'weekly';

export interface ISuggestedKeyword {
  keyword: string;
  dismissed: boolean;
  source: string;
  createdAt: Date;
}

export interface IGoogleIntegration {
  gaPropertyId?: string | null;
  gscSiteUrl?: string | null;
  encryptedRefreshToken?: string | null;
  scopes?: string[];
  connectedAt?: Date | null;
  lastSyncedAt?: Date | null;
}

export interface IProject extends Document {
  name: string;
  domain: string;
  stagingDomain?: string;
  auditSchedule: AuditSchedule;
  suggestedKeywords: ISuggestedKeyword[];
  googleIntegration?: IGoogleIntegration | null;
  createdAt: Date;
  deletedAt?: Date | null;
}

const SuggestedKeywordSchema = new Schema<ISuggestedKeyword>({
  keyword: { type: String, required: true, trim: true },
  dismissed: { type: Boolean, default: false },
  source: { type: String, default: 'audit' },
  createdAt: { type: Date, default: Date.now },
});

const GoogleIntegrationSchema = new Schema<IGoogleIntegration>({
  gaPropertyId: { type: String, default: null },
  gscSiteUrl: { type: String, default: null },
  encryptedRefreshToken: { type: String, default: null },
  scopes: { type: [String], default: [] },
  connectedAt: { type: Date, default: null },
  lastSyncedAt: { type: Date, default: null },
}, { _id: false });

const ProjectSchema = new Schema<IProject>({
  name: {
    type: String,
    required: true,
    trim: true,
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
  googleIntegration: {
    type: GoogleIntegrationSchema,
    default: null,
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

ProjectSchema.index({ deletedAt: 1 });

export const Project = model<IProject>('Project', ProjectSchema);
export default Project;
