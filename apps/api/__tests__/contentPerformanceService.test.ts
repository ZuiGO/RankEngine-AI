import {
  computePageSeoMetrics,
  computeReadabilityScore,
  countSyllables,
} from '../src/services/contentPerformanceService';

describe('contentPerformanceService - Unit Tests (Scoring Rubric)', () => {
  describe('Syllables & Readability Helpers', () => {
    it('counts syllables accurately using vowel-group heuristic', () => {
      expect(countSyllables('the')).toBe(1);
      expect(countSyllables('simple')).toBe(2);
      expect(countSyllables('optimization')).toBe(5);
    });

    it('computes Flesch Reading Ease score', () => {
      const text = 'This is a simple sentence. Easy to read text for testing purposes.';
      const score = computeReadabilityScore(text, 12);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('computePageSeoMetrics Rubric', () => {
    it('scores a perfect page 100/100 with zero issues', () => {
      const rawPage = {
        url: 'https://example.com/perfect',
        path: '/perfect',
        title: 'Optimal Page Title For Testing Purposes Here!', // 46 chars (30-60 range)
        metaDescription: 'This is a perfectly sized meta description that easily satisfies the required 120-158 characters length rubric without any issues.', // 137 chars
        h1Text: ['Main Page Headline'],
        h2Count: 2,
        wordCount: 650,
        readabilityScore: 75,
        imageCount: 5,
        imagesWithAlt: 5,
        imagesMissingAlt: 0,
        internalLinkCount: 4,
        externalLinkCount: 2,
        hasStructuredData: true,
        structuredDataTypes: ['Article'],
        canonicalUrl: 'https://example.com/perfect',
        isIndexable: true,
      };

      const metrics = computePageSeoMetrics(rawPage);
      expect(metrics.seoScore).toBe(100);
      expect(metrics.issues).toHaveLength(0);
    });

    it('handles title scoring & issue generation (missing vs outside range)', () => {
      // Missing title
      const missingTitle = computePageSeoMetrics({
        url: 'https://example.com/no-title',
        title: null,
      });
      expect(missingTitle.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: 'critical', category: 'title', message: 'Missing <title> tag' }),
        ])
      );

      // Short title (< 30 chars)
      const shortTitle = computePageSeoMetrics({
        url: 'https://example.com/short-title',
        title: 'Short Title', // 11 chars
      });
      expect(shortTitle.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: 'warning', category: 'title' }),
        ])
      );
    });

    it('handles meta description scoring & issue generation', () => {
      // Missing meta description
      const missingMeta = computePageSeoMetrics({
        url: 'https://example.com/no-meta',
        metaDescription: null,
      });
      expect(missingMeta.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: 'warning', category: 'meta', message: 'Missing meta description' }),
        ])
      );

      // Short meta description
      const shortMeta = computePageSeoMetrics({
        url: 'https://example.com/short-meta',
        metaDescription: 'Short meta desc.',
      });
      expect(shortMeta.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: 'info', category: 'meta' }),
        ])
      );
    });

    it('handles headings scoring (0 H1s vs 2+ H1s vs missing H2s)', () => {
      // Zero H1
      const zeroH1 = computePageSeoMetrics({
        url: 'https://example.com/no-h1',
        h1Text: [],
      });
      expect(zeroH1.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: 'critical', category: 'headings', message: 'Missing H1 heading' }),
        ])
      );

      // Multiple H1s
      const multiH1 = computePageSeoMetrics({
        url: 'https://example.com/multi-h1',
        h1Text: ['Headline 1', 'Headline 2'],
      });
      expect(multiH1.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: 'warning', category: 'headings', message: 'Multiple H1 headings found (2)' }),
        ])
      );
    });

    it('handles content quality & thin content warning', () => {
      const thinContent = computePageSeoMetrics({
        url: 'https://example.com/thin',
        wordCount: 150,
      });
      expect(thinContent.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: 'warning', category: 'content', message: 'Thin content: 150 words' }),
        ])
      );
    });

    it('handles image alt text missing warning (>20% missing)', () => {
      const missingAlt = computePageSeoMetrics({
        url: 'https://example.com/imgs',
        imageCount: 10,
        imagesWithAlt: 5,
        imagesMissingAlt: 5, // 50% missing (>20%)
      });
      expect(missingAlt.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: 'warning', category: 'images', message: '5 of 10 images missing alt text' }),
        ])
      );
    });

    it('handles internal links warning when 0 internal links found', () => {
      const noLinks = computePageSeoMetrics({
        url: 'https://example.com/no-links',
        internalLinkCount: 0,
      });
      expect(noLinks.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: 'warning', category: 'links', message: 'No internal links found on this page' }),
        ])
      );
    });

    it('handles structured data info issue when absent', () => {
      const noSchema = computePageSeoMetrics({
        url: 'https://example.com/no-schema',
        hasStructuredData: false,
      });
      expect(noSchema.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: 'info', category: 'structured-data', message: 'No structured data (JSON-LD) found' }),
        ])
      );
    });

    it('handles indexability & canonical mismatch issues', () => {
      const noindexPage = computePageSeoMetrics({
        url: 'https://example.com/noindex',
        isIndexable: false,
        canonicalUrl: 'https://example.com/different-canonical',
      });

      expect(noindexPage.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ severity: 'critical', category: 'indexability', message: 'Page is set to noindex' }),
          expect.objectContaining({ severity: 'warning', category: 'indexability', message: 'Canonical points to a different URL' }),
        ])
      );
    });
  });
});
