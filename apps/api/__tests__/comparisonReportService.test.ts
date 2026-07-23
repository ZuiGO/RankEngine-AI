import {
  matchPages,
  diffPages,
  normalizePath,
} from '../src/services/comparisonReportService';
import { PageSeoMetrics } from '@rankengine/shared-types';

describe('comparisonReportService - Unit Tests', () => {
  describe('normalizePath', () => {
    it('normalizes URLs and paths cleanly', () => {
      expect(normalizePath('https://example.com/blog/my-post/')).toBe('/blog/my-post');
      expect(normalizePath('/products/?ref=123#reviews')).toBe('/products');
      expect(normalizePath('https://example.com')).toBe('/');
    });
  });

  describe('matchPages & pathOverrides', () => {
    const pageA: PageSeoMetrics = {
      url: 'https://old.com/about',
      path: '/about',
      title: 'About Us Page Title 35 Characters',
      titleLength: 35,
      metaDescription: 'A description',
      metaDescriptionLength: 13,
      h1Count: 1,
      h1Text: ['About Us'],
      h2Count: 2,
      wordCount: 500,
      readabilityScore: 70,
      imageCount: 2,
      imagesWithAlt: 2,
      imagesMissingAlt: 0,
      internalLinkCount: 4,
      externalLinkCount: 1,
      hasStructuredData: true,
      structuredDataTypes: ['WebPage'],
      canonicalUrl: 'https://old.com/about',
      isIndexable: true,
      cwv: { lcp: 1500, inp: 100, cls: 0.05, fcp: 800, ttfb: 200 },
      analytics: null,
      searchConsole: null,
      seoScore: 90,
      issues: [],
    };

    const pageOldSlug: PageSeoMetrics = {
      ...pageA,
      url: 'https://old.com/blog/old-slug',
      path: '/blog/old-slug',
    };

    const pageRemoved: PageSeoMetrics = {
      ...pageA,
      url: 'https://old.com/deprecated',
      path: '/deprecated',
    };

    const pageNewSlug: PageSeoMetrics = {
      ...pageA,
      url: 'https://new.com/articles/new-slug',
      path: '/articles/new-slug',
      seoScore: 95,
    };

    const pageAdded: PageSeoMetrics = {
      ...pageA,
      url: 'https://new.com/new-feature',
      path: '/new-feature',
    };

    it('handles exact matches, path overrides, added pages, and removed pages', () => {
      const oldPages = [pageA, pageOldSlug, pageRemoved];
      const newPages = [pageA, pageNewSlug, pageAdded];

      const pathOverrides = [{ oldPath: '/blog/old-slug', newPath: '/articles/new-slug' }];

      const matched = matchPages(oldPages, newPages, pathOverrides);

      expect(matched).toHaveLength(4);

      // Exact match for /about
      const aboutMatch = matched.find((m) => m.path === '/about');
      expect(aboutMatch).toBeDefined();
      expect(aboutMatch?.status).toBe('matched');

      // Override match for /articles/new-slug
      const overrideMatch = matched.find((m) => m.path === '/articles/new-slug');
      expect(overrideMatch).toBeDefined();
      expect(overrideMatch?.status).toBe('matched');
      expect(overrideMatch?.before?.path).toBe('/blog/old-slug');
      expect(overrideMatch?.after?.path).toBe('/articles/new-slug');

      // Removed page /deprecated
      const removedMatch = matched.find((m) => m.path === '/deprecated');
      expect(removedMatch).toBeDefined();
      expect(removedMatch?.status).toBe('removed');
      expect(removedMatch?.after).toBeNull();

      // Added page /new-feature
      const addedMatch = matched.find((m) => m.path === '/new-feature');
      expect(addedMatch).toBeDefined();
      expect(addedMatch?.status).toBe('added');
      expect(addedMatch?.before).toBeNull();
    });
  });

  describe('diffPages', () => {
    const baseBefore: PageSeoMetrics = {
      url: 'https://example.com/test',
      path: '/test',
      title: 'Original Title 35 Characters Long',
      titleLength: 35,
      metaDescription: 'Original description for testing.',
      metaDescriptionLength: 34,
      h1Count: 1,
      h1Text: ['Original H1'],
      h2Count: 2,
      wordCount: 300,
      readabilityScore: 60,
      imageCount: 4,
      imagesWithAlt: 4,
      imagesMissingAlt: 0,
      internalLinkCount: 2,
      externalLinkCount: 1,
      hasStructuredData: false,
      structuredDataTypes: [],
      canonicalUrl: 'https://example.com/test',
      isIndexable: true,
      cwv: { lcp: 1800, inp: 120, cls: 0.04, fcp: 900, ttfb: 250 },
      analytics: null,
      searchConsole: null,
      seoScore: 70,
      issues: [],
    };

    it('identifies improvements, regressions, neutral changes, and CWV regressions', () => {
      const baseAfter: PageSeoMetrics = {
        ...baseBefore,
        title: 'New Title Text 35 Characters Long', // Text changed, length band neutral
        wordCount: 800, // Improvement (300 -> 800)
        imagesMissingAlt: 3, // Regression (0 -> 3)
        hasStructuredData: true, // Improvement (false -> true)
        seoScore: 90, // Improvement (70 -> 90)
        cwv: { lcp: 3500, inp: 120, cls: 0.04, fcp: 900, ttfb: 250 }, // CWV LCP Regression (1800 -> 3500)
      };

      const changes = diffPages(baseBefore, baseAfter);

      const titleChange = changes.find((c) => c.field === 'title');
      expect(titleChange).toBeDefined();
      expect(titleChange?.impact).toBe('neutral');

      const wordCountChange = changes.find((c) => c.field === 'wordCount');
      expect(wordCountChange).toBeDefined();
      expect(wordCountChange?.impact).toBe('improvement');

      const imagesChange = changes.find((c) => c.field === 'imagesMissingAlt');
      expect(imagesChange).toBeDefined();
      expect(imagesChange?.impact).toBe('regression');

      const schemaChange = changes.find((c) => c.field === 'hasStructuredData');
      expect(schemaChange).toBeDefined();
      expect(schemaChange?.impact).toBe('improvement');

      const cwvLcpChange = changes.find((c) => c.field === 'cwv.lcp');
      expect(cwvLcpChange).toBeDefined();
      expect(cwvLcpChange?.impact).toBe('regression');
    });
  });
});
