import { Schema, model, Document } from 'mongoose';

export interface IBeforeAfterComparisonReportDoc extends Document {
  projectId: string;
  generatedAt: Date;
  oldSiteUrl: string;
  newSiteUrl: string;
  oldCrawlJobId: string;
  newCrawlJobId: string;
  overallScoreBefore: number;
  overallScoreAfter: number;
  pagesImproved: number;
  pagesRegressed: number;
  pagesUnchanged: number;
  pagesAdded: number;
  pagesRemoved: number;
  pages: any[];
  note: string;
  createdAt: Date;
}

const BeforeAfterComparisonReportSchema = new Schema<IBeforeAfterComparisonReportDoc>({
  projectId: { type: String, required: true, index: true },
  generatedAt: { type: Date, default: Date.now },
  oldSiteUrl: { type: String, required: true },
  newSiteUrl: { type: String, required: true },
  oldCrawlJobId: { type: String, required: true },
  newCrawlJobId: { type: String, required: true },
  overallScoreBefore: { type: Number, required: true },
  overallScoreAfter: { type: Number, required: true },
  pagesImproved: { type: Number, required: true },
  pagesRegressed: { type: Number, required: true },
  pagesUnchanged: { type: Number, required: true },
  pagesAdded: { type: Number, required: true },
  pagesRemoved: { type: Number, required: true },
  pages: [Schema.Types.Mixed],
  note: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

BeforeAfterComparisonReportSchema.index({ projectId: 1, createdAt: -1 });

export const BeforeAfterComparisonReportModel = model<IBeforeAfterComparisonReportDoc>(
  'BeforeAfterComparisonReport',
  BeforeAfterComparisonReportSchema,
  'beforeaftercomparisonreports'
);

export default BeforeAfterComparisonReportModel;
