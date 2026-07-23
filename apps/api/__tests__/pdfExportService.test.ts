import {
  buildContentPerformanceHtml,
  buildComparisonHtml,
  renderPdf,
} from '../src/services/pdfExportService';
import {
  ContentPerformanceReport,
  BeforeAfterComparisonReport,
} from '@rankengine/shared-types';

describe('pdfExportService - PDF Report Generation Tests', () => {
  it('Generating a PDF for a content-performance report produces a buffer starting with %PDF', async () => {
    const mockContentReport: ContentPerformanceReport = {
      reportId: 'rep-1',
      projectId: 'proj-1',
      crawlJobId: 'job-1',
      generatedAt: new Date().toISOString(),
      siteUrl: 'https://example.com',
      overallScore: 85,
      pageCount: 1,
      pages: [
        {
          url: 'https://example.com/',
          path: '/',
          title: 'Sample Title for Content Performance Report',
          titleLength: 42,
          metaDescription: 'Sample description length that easily satisfies the required 120-158 characters length rubric.',
          metaDescriptionLength: 100,
          h1Count: 1,
          h1Text: ['Sample H1'],
          h2Count: 2,
          wordCount: 750,
          readabilityScore: 72,
          imageCount: 2,
          imagesWithAlt: 2,
          imagesMissingAlt: 0,
          internalLinkCount: 4,
          externalLinkCount: 1,
          hasStructuredData: true,
          structuredDataTypes: ['Article'],
          canonicalUrl: 'https://example.com/',
          isIndexable: true,
          cwv: null,
          analytics: {
            sessions: 300,
            engagementRate: 0.65,
            avgEngagementTimeSec: 45,
            conversions: 8,
          },
          searchConsole: {
            clicks: 120,
            impressions: 2500,
            ctr: 0.048,
            avgPosition: 4.2,
          },
          seoScore: 92,
          issues: [],
        },
      ],
      summary: {
        avgScore: 85,
        criticalIssueCount: 0,
        warningIssueCount: 0,
        topIssueCategories: [],
      },
      gaConnected: true,
      gscConnected: true,
    };

    const html = buildContentPerformanceHtml(mockContentReport);
    expect(html).toContain('Content Performance Report');
    expect(html).toContain('https://example.com');

    const pdfBuffer = await renderPdf(html);
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.toString('utf-8').startsWith('%PDF')).toBe(true);
  });

  it('Generating a PDF for a before-after-comparison report produces a buffer starting with %PDF', async () => {
    const mockComparisonReport: BeforeAfterComparisonReport = {
      reportId: 'comp-1',
      projectId: 'proj-1',
      generatedAt: new Date().toISOString(),
      oldSiteUrl: 'https://live-site.com',
      newSiteUrl: 'https://staging-site.com',
      oldCrawlJobId: 'job-old',
      newCrawlJobId: 'job-new',
      overallScoreBefore: 62,
      overallScoreAfter: 78,
      pagesImproved: 1,
      pagesRegressed: 0,
      pagesUnchanged: 0,
      pagesAdded: 0,
      pagesRemoved: 0,
      pages: [
        {
          path: '/',
          oldUrl: 'https://live-site.com/',
          newUrl: 'https://staging-site.com/',
          matched: true,
          status: 'matched',
          before: null,
          after: null,
          scoreDelta: 16,
          changes: [
            {
              field: 'seoScore',
              before: 62,
              after: 78,
              impact: 'improvement',
            },
          ],
        },
      ],
      note: 'This comparison is based on on-page and technical SEO signals.',
    };

    const html = buildComparisonHtml(mockComparisonReport);
    expect(html).toContain('Before / After Comparison Report');
    expect(html).toContain('https://live-site.com');
    expect(html).toContain('https://staging-site.com');

    const pdfBuffer = await renderPdf(html);
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.toString('utf-8').startsWith('%PDF')).toBe(true);
  });
});
