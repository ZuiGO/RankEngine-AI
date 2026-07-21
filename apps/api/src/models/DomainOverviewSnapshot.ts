import { Schema, model, Document, Types } from 'mongoose';

export interface IDomainOverviewSnapshot extends Document {
  projectId: Types.ObjectId;
  date: string;
  organicTrafficEstimate: number;
  organicKeywordCount: number;
  topKeywords: { keyword: string; searchVolume?: number; position?: number }[];
  cachedAt: Date;
}

const DomainOverviewSnapshotSchema = new Schema<IDomainOverviewSnapshot>({
  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
  },
  date: {
    type: String,
    required: true,
  },
  organicTrafficEstimate: {
    type: Number,
    default: 0,
  },
  organicKeywordCount: {
    type: Number,
    default: 0,
  },
  topKeywords: {
    type: Schema.Types.Mixed,
    default: [],
  },
  cachedAt: {
    type: Date,
    default: Date.now,
  },
});

DomainOverviewSnapshotSchema.index({ projectId: 1, date: 1 }, { unique: true });

export const DomainOverviewSnapshot = model<IDomainOverviewSnapshot>(
  'DomainOverviewSnapshot',
  DomainOverviewSnapshotSchema
);
export default DomainOverviewSnapshot;
