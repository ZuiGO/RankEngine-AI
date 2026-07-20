import { Schema, model, Document, Types } from 'mongoose';

export type AiEngine = 'chatgpt' | 'gemini' | 'perplexity' | 'google_aio';

export interface IAiVisibilitySnapshot extends Document {
  trackedPromptId: Types.ObjectId;
  engine: AiEngine;
  mentioned: boolean;
  mentionContext: string;
  checkedAt: Date;
}

const AiVisibilitySnapshotSchema = new Schema<IAiVisibilitySnapshot>({
  trackedPromptId: {
    type: Schema.Types.ObjectId,
    ref: 'TrackedPrompt',
    required: true,
  },
  engine: {
    type: String,
    enum: ['chatgpt', 'gemini', 'perplexity', 'google_aio'],
    required: true,
  },
  mentioned: {
    type: Boolean,
    default: false,
  },
  mentionContext: {
    type: String,
    default: '',
    maxlength: 200,
  },
  checkedAt: {
    type: Date,
    default: Date.now,
  },
});

AiVisibilitySnapshotSchema.index({ trackedPromptId: 1, engine: 1, checkedAt: -1 });

export const AiVisibilitySnapshot = model<IAiVisibilitySnapshot>(
  'AiVisibilitySnapshot',
  AiVisibilitySnapshotSchema,
);
export default AiVisibilitySnapshot;
