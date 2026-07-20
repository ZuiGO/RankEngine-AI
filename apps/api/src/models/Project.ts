import { Schema, model, Document, Types } from 'mongoose';

export type AuditSchedule = 'manual' | 'daily' | 'weekly';

export interface IProject extends Document {
  name: string;
  ownerId: Types.ObjectId;
  domain: string;
  stagingDomain?: string;
  auditSchedule: AuditSchedule;
  createdAt: Date;
  deletedAt?: Date | null;
}

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
