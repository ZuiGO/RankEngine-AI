import { Schema, model, Document } from 'mongoose';

export interface IDomainOverviewCache extends Document {
  cacheKey: string;
  dateBucket: string;
  domain: string;
  organicTrafficEstimate: number;
  organicKeywordCount: number;
  topKeywords: { keyword: string; searchVolume?: number; position?: number }[];
  cachedAt: Date;
}

const DomainOverviewCacheSchema = new Schema<IDomainOverviewCache>({
  cacheKey: {
    type: String,
    required: true,
  },
  dateBucket: {
    type: String,
    required: true,
  },
  domain: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
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

DomainOverviewCacheSchema.index({ cacheKey: 1, dateBucket: 1 }, { unique: true });
DomainOverviewCacheSchema.index({ cachedAt: 1 }, { expireAfterSeconds: 259200 });

export const DomainOverviewCache = model<IDomainOverviewCache>(
  'DomainOverviewCache',
  DomainOverviewCacheSchema
);
export default DomainOverviewCache;
