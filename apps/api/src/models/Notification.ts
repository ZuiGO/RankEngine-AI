import mongoose, { Schema, Document, Types } from 'mongoose';

export interface INotification extends Document {
  projectId: Types.ObjectId;
  keywordId?: Types.ObjectId;
  message: string;
  read: boolean;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  keywordId: { type: Schema.Types.ObjectId, ref: 'TrackedKeyword', required: false },
  message: { type: String, required: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
