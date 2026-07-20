import { Schema, model, Document } from 'mongoose';

export interface IBacklinkDataCache extends Document {
  cacheKey: string;
  dateBucket: string;
  domain: string;
  totalBacklinks: number;
  referringDomains: number;
  domainRating: number;
  cachedAt: Date;
}

const BacklinkDataCacheSchema = new Schema<IBacklinkDataCache>({
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
  totalBacklinks: {
    type: Number,
    default: 0,
  },
  referringDomains: {
    type: Number,
    default: 0,
  },
  domainRating: {
    type: Number,
    default: 0,
  },
  cachedAt: {
    type: Date,
    default: Date.now,
  },
});

BacklinkDataCacheSchema.index({ cacheKey: 1, dateBucket: 1 }, { unique: true });
BacklinkDataCacheSchema.index({ cachedAt: 1 }, { expireAfterSeconds: 259200 });

export const BacklinkDataCache = model<IBacklinkDataCache>('BacklinkDataCache', BacklinkDataCacheSchema);
export default BacklinkDataCache;
