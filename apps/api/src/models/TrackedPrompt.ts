import { Schema, model, Document, Types } from 'mongoose';

export interface ITrackedPrompt extends Document {
  projectId: Types.ObjectId;
  promptText: string;
  brandTerm: string;
  createdAt: Date;
}

const TrackedPromptSchema = new Schema<ITrackedPrompt>({
  projectId: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true,
  },
  promptText: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000,
  },
  brandTerm: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    maxlength: 200,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

TrackedPromptSchema.index({ projectId: 1, createdAt: -1 });

export const TrackedPrompt = model<ITrackedPrompt>('TrackedPrompt', TrackedPromptSchema);
export default TrackedPrompt;
