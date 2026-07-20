import { Schema, model, Document } from 'mongoose';

export interface IKeywordDataCache extends Document {
  cacheKey: string;
  dateBucket: string;
  keyword: string;
  locationCode?: string;
  searchVolume: number;
  difficulty: number;
  cpc: number;
  intent: string;
  relatedKeywords: string[];
  cachedAt: Date;
}

const KeywordDataCacheSchema = new Schema<IKeywordDataCache>({
  cacheKey: {
    type: String,
    required: true,
  },
  dateBucket: {
    type: String,
    required: true,
  },
  keyword: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  locationCode: {
    type: String,
    default: null,
  },
  searchVolume: {
    type: Number,
    default: 0,
  },
  difficulty: {
    type: Number,
    default: 0,
  },
  cpc: {
    type: Number,
    default: 0,
  },
  intent: {
    type: String,
    default: '',
  },
  relatedKeywords: {
    type: [String],
    default: [],
  },
  cachedAt: {
    type: Date,
    default: Date.now,
  },
});

KeywordDataCacheSchema.index({ cacheKey: 1, dateBucket: 1 }, { unique: true });
KeywordDataCacheSchema.index({ cachedAt: 1 }, { expireAfterSeconds: 604800 });

export const KeywordDataCache = model<IKeywordDataCache>(
  'KeywordDataCache',
  KeywordDataCacheSchema
);
export default KeywordDataCache;
