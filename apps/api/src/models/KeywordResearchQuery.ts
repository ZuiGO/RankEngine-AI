import { Schema, model, Document, Types } from 'mongoose';

export interface IKeywordResearchQuery extends Document {
  userId: Types.ObjectId;
  seedKeyword: string;
  locationCode?: string;
  timestamp: Date;
}

const KeywordResearchQuerySchema = new Schema<IKeywordResearchQuery>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  seedKeyword: {
    type: String,
    required: true,
    trim: true,
  },
  locationCode: {
    type: String,
    default: null,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

KeywordResearchQuerySchema.index({ userId: 1, timestamp: -1 });

export const KeywordResearchQuery = model<IKeywordResearchQuery>(
  'KeywordResearchQuery',
  KeywordResearchQuerySchema
);
export default KeywordResearchQuery;
