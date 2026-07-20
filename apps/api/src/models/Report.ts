import { Schema, model, Document, Types } from 'mongoose';

export interface IReport extends Document {
  projectId: Types.ObjectId;
  crawlJobId: Types.ObjectId;
  generatedBy: Types.ObjectId;
  filePath: string;
  fileSize: number;
  downloadToken: string;
  tokenExpiresAt: Date;
  createdAt: Date;
}

const ReportSchema = new Schema<IReport>({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
  crawlJobId: { type: Schema.Types.ObjectId, ref: 'CrawlJob', required: true },
  generatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  filePath: { type: String, required: true },
  fileSize: { type: Number, required: true },
  downloadToken: { type: String, required: true },
  tokenExpiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

ReportSchema.index({ projectId: 1, createdAt: -1 });
ReportSchema.index({ downloadToken: 1 });

export const Report = model<IReport>('Report', ReportSchema);
export default Report;
