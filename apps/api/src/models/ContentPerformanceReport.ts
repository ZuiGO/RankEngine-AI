import { Schema, model, Document } from 'mongoose';

export interface IContentPerformanceReportDoc extends Document {
  projectId: string;
  crawlJobId: string;
  generatedAt: Date;
  siteUrl: string;
  overallScore: number;
  pageCount: number;
  pages: any[];
  summary: {
    avgScore: number;
    criticalIssueCount: number;
    warningIssueCount: number;
    topIssueCategories: Array<{ category: string; count: number }>;
  };
  gaConnected: boolean;
  gscConnected: boolean;
  createdAt: Date;
}

const ContentPerformanceReportSchema = new Schema<IContentPerformanceReportDoc>({
  projectId: { type: String, required: true, index: true },
  crawlJobId: { type: String, required: true, index: true },
  generatedAt: { type: Date, default: Date.now },
  siteUrl: { type: String, required: true },
  overallScore: { type: Number, required: true },
  pageCount: { type: Number, required: true },
  pages: [Schema.Types.Mixed],
  summary: {
    avgScore: { type: Number, required: true },
    criticalIssueCount: { type: Number, required: true },
    warningIssueCount: { type: Number, required: true },
    topIssueCategories: [
      {
        category: { type: String, required: true },
        count: { type: Number, required: true },
        _id: false,
      },
    ],
  },
  gaConnected: { type: Boolean, default: false },
  gscConnected: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

ContentPerformanceReportSchema.index({ projectId: 1, createdAt: -1 });

export const ContentPerformanceReportModel = model<IContentPerformanceReportDoc>(
  'ContentPerformanceReport',
  ContentPerformanceReportSchema,
  'contentperformancereports'
);

export default ContentPerformanceReportModel;
