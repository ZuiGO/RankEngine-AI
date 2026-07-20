import { Schema, model, Document, Types } from 'mongoose';

export interface IBacklinkSnapshot extends Document {
  projectId: Types.ObjectId;
  date: string;
  totalBacklinks: number;
  referringDomains: number;
  authorityScore: number;
  cachedAt: Date;
}

const BacklinkSnapshotSchema = new Schema<IBacklinkSnapshot>({
  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
  },
  date: {
    type: String,
    required: true,
  },
  totalBacklinks: {
    type: Number,
    default: 0,
  },
  referringDomains: {
    type: Number,
    default: 0,
  },
  authorityScore: {
    type: Number,
    default: 0,
  },
  cachedAt: {
    type: Date,
    default: Date.now,
  },
});

BacklinkSnapshotSchema.index({ projectId: 1, date: 1 }, { unique: true });

export const BacklinkSnapshot = model<IBacklinkSnapshot>(
  'BacklinkSnapshot',
  BacklinkSnapshotSchema
);
export default BacklinkSnapshot;
