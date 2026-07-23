import mongoose from 'mongoose';
import {
  ContentPerformanceReport,
  PageSeoMetrics,
  SeoIssue,
  PageAnalyticsSnapshot,
  PageSearchConsoleSnapshot,
} from '@rankengine/shared-types';
import CrawlJob from '../models/CrawlJob';
import Project from '../models/Project';
import ContentPerformanceReportModel from '../models/ContentPerformanceReport';
import * as googleAnalyticsService from './googleAnalyticsService';
import * as searchConsoleService from './searchConsoleService';

export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  if (w.length <= 3) return 1;
  let count = (w.match(/[aeiouy]+/g) || []).length;
  if (w.endsWith('e') && !w.endsWith('le') && !w.endsWith('ee')) {
    count--;
  }
  return Math.max(1, count);
}

export function computeReadabilityScore(text: string, wordCount: number): number {
  if (!wordCount || wordCount <= 0) return 0;

  const wordsList = text ? text.split(/\s+/).filter(Boolean) : [];
  const words = Math.max(1, wordCount);

  let sentenceCount = 0;
  if (text) {
    sentenceCount = (text.match(/[.!?]+/g) || []).length;
  }
  const sentences = Math.max(1, sentenceCount || Math.round(words / 15));

  let totalSyllables = 0;
  if (wordsList.length > 0) {
    for (const w of wordsList) {
      totalSyllables += countSyllables(w);
    }
  } else {
    totalSyllables = Math.round(words * 1.4);
  }

  const score = 206.835 - 1.015 * (words / sentences) - 84.6 * (totalSyllables / words);
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Deterministically compute page-level SEO metrics & score based on exact 0-100 rubric.
 */
export function computePageSeoMetrics(rawPage: any): PageSeoMetrics {
  const issues: SeoIssue[] = [];
  const url: string = rawPage.url || '';
  let path = '/';
  if (rawPage.path) {
    path = rawPage.path;
  } else if (url) {
    try {
      path = new URL(url).pathname || '/';
    } catch {
      path = '/';
    }
  }

  // 1. Title (15 pts max)
  let titleScore = 0;
  const rawTitle = rawPage.title !== undefined ? rawPage.title : (rawPage.metaTitle || null);
  const title: string | null = (typeof rawTitle === 'string' && rawTitle.trim().length > 0) ? rawTitle.trim() : null;
  const titleLength = title ? title.length : 0;

  if (title) {
    if (titleLength >= 30 && titleLength <= 60) {
      titleScore = 15;
    } else {
      titleScore = 8;
      issues.push({
        severity: 'warning',
        category: 'title',
        message: `Title length is ${titleLength} characters; recommended 30-60`,
      });
    }
  } else {
    titleScore = 0;
    issues.push({
      severity: 'critical',
      category: 'title',
      message: 'Missing <title> tag',
    });
  }

  // 2. Meta Description (10 pts max)
  let metaScore = 0;
  const rawDesc = rawPage.metaDescription;
  const metaDescription: string | null = (typeof rawDesc === 'string' && rawDesc.trim().length > 0) ? rawDesc.trim() : null;
  const metaDescriptionLength = metaDescription ? metaDescription.length : 0;

  if (metaDescription) {
    if (metaDescriptionLength >= 120 && metaDescriptionLength <= 158) {
      metaScore = 10;
    } else {
      metaScore = 5;
      issues.push({
        severity: 'info',
        category: 'meta',
        message: `Meta description length is ${metaDescriptionLength} characters; recommended 120-158`,
      });
    }
  } else {
    metaScore = 0;
    issues.push({
      severity: 'warning',
      category: 'meta',
      message: 'Missing meta description',
    });
  }

  // 3. Headings (15 pts max)
  let headingScore = 0;
  const h1Text: string[] = rawPage.h1Text || rawPage.h1 || [];
  const h1Count = h1Text.length;
  const h2Count = rawPage.h2Count !== undefined ? rawPage.h2Count : (rawPage.h2 ? rawPage.h2.length : 0);

  if (h1Count === 1) {
    if (h2Count >= 1) {
      headingScore = 15;
    } else {
      headingScore = 7;
    }
  } else {
    headingScore = 0;
  }

  if (h1Count === 0) {
    issues.push({
      severity: 'critical',
      category: 'headings',
      message: 'Missing H1 heading',
    });
  } else if (h1Count >= 2) {
    issues.push({
      severity: 'warning',
      category: 'headings',
      message: `Multiple H1 headings found (${h1Count})`,
    });
  }

  // 4. Content Quality (20 pts max)
  const wordCount = rawPage.wordCount || 0;
  let wordCountScore = 0;
  if (wordCount >= 600) {
    wordCountScore = 12;
  } else if (wordCount >= 300) {
    wordCountScore = 7;
  } else {
    wordCountScore = 0;
    issues.push({
      severity: 'warning',
      category: 'content',
      message: `Thin content: ${wordCount} words`,
    });
  }

  const visibleText = rawPage.visibleText || rawPage.text || rawPage.content || '';
  const readabilityScore = rawPage.readabilityScore !== undefined
    ? Math.min(100, Math.max(0, rawPage.readabilityScore))
    : computeReadabilityScore(visibleText, wordCount);

  let readabilityPortion = 0;
  if (readabilityScore >= 60) {
    readabilityPortion = 8;
  } else if (readabilityScore >= 30) {
    readabilityPortion = 4;
  } else {
    readabilityPortion = 0;
    issues.push({
      severity: 'info',
      category: 'content',
      message: 'Content may be hard to read',
    });
  }

  // 5. Images (10 pts max)
  const imageCount = rawPage.imageCount !== undefined ? rawPage.imageCount : 0;
  const imagesWithAlt = rawPage.imagesWithAlt !== undefined ? rawPage.imagesWithAlt : 0;
  const imagesMissingAlt = rawPage.imagesMissingAlt !== undefined ? rawPage.imagesMissingAlt : Math.max(0, imageCount - imagesWithAlt);

  let imageScore = 10;
  if (imageCount > 0) {
    imageScore = Math.round(10 * (imagesWithAlt / imageCount));
    if ((imagesMissingAlt / imageCount) > 0.2) {
      issues.push({
        severity: 'warning',
        category: 'images',
        message: `${imagesMissingAlt} of ${imageCount} images missing alt text`,
      });
    }
  }

  // 6. Internal Linking (10 pts max)
  const internalLinkCount = rawPage.internalLinkCount || 0;
  const externalLinkCount = rawPage.externalLinkCount || 0;
  let linkScore = 0;
  if (internalLinkCount >= 3) {
    linkScore = 10;
  } else if (internalLinkCount >= 1) {
    linkScore = 5;
  } else {
    linkScore = 0;
    issues.push({
      severity: 'warning',
      category: 'links',
      message: 'No internal links found on this page',
    });
  }

  // 7. Structured Data (10 pts max)
  const hasStructuredData = Boolean(rawPage.hasStructuredData);
  const structuredDataTypes = rawPage.structuredDataTypes || [];
  let structuredDataScore = 0;
  if (hasStructuredData) {
    structuredDataScore = 10;
  } else {
    structuredDataScore = 0;
    issues.push({
      severity: 'info',
      category: 'structured-data',
      message: 'No structured data (JSON-LD) found',
    });
  }

  // 8. Indexability & Canonical (10 pts max)
  const isIndexable = rawPage.isIndexable !== undefined ? Boolean(rawPage.isIndexable) : !Boolean(rawPage.meta_noindex);
  const canonicalUrl = rawPage.canonicalUrl !== undefined ? rawPage.canonicalUrl : (rawPage.canonical || null);

  let canonicalMatches = true;
  if (canonicalUrl && url) {
    const cleanUrl = url.split('#')[0].split('?')[0].replace(/\/$/, '');
    const cleanCanonical = canonicalUrl.split('#')[0].split('?')[0].replace(/\/$/, '');
    if (cleanCanonical !== cleanUrl) {
      canonicalMatches = false;
    }
  }

  let indexabilityScore = 0;
  if (isIndexable && canonicalMatches) {
    indexabilityScore = 10;
  } else {
    indexabilityScore = 0;
  }

  if (!isIndexable) {
    issues.push({
      severity: 'critical',
      category: 'indexability',
      message: 'Page is set to noindex',
    });
  }
  if (!canonicalMatches) {
    issues.push({
      severity: 'warning',
      category: 'indexability',
      message: 'Canonical points to a different URL',
    });
  }

  const rawSum = titleScore + metaScore + headingScore + wordCountScore + readabilityPortion + imageScore + linkScore + structuredDataScore + indexabilityScore;
  const seoScore = Math.min(100, Math.max(0, rawSum));

  return {
    url,
    path,
    title,
    titleLength,
    metaDescription,
    metaDescriptionLength,
    h1Count,
    h1Text,
    h2Count,
    wordCount,
    readabilityScore,
    imageCount,
    imagesWithAlt,
    imagesMissingAlt,
    internalLinkCount,
    externalLinkCount,
    hasStructuredData,
    structuredDataTypes,
    canonicalUrl,
    isIndexable,
    cwv: rawPage.cwv || null,
    analytics: rawPage.analytics || null,
    searchConsole: rawPage.searchConsole || null,
    seoScore,
    issues,
  };
}

export async function computeReport(crawlJobId: string): Promise<ContentPerformanceReport> {
  const crawlJob = await CrawlJob.findById(crawlJobId);
  if (!crawlJob) {
    throw new Error('Crawl job not found');
  }

  const project = await Project.findById(crawlJob.projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection not established');
  }

  let rawPages: any[] = [];
  if (crawlJob.rawResultsRef && mongoose.Types.ObjectId.isValid(crawlJob.rawResultsRef)) {
    const rawResultDoc = await db.collection('crawlresults').findOne({ _id: new mongoose.Types.ObjectId(crawlJob.rawResultsRef) });
    if (rawResultDoc && Array.isArray(rawResultDoc.pages)) {
      rawPages = rawResultDoc.pages;
    }
  }

  const pagesMetrics: PageSeoMetrics[] = rawPages.map((rp) => computePageSeoMetrics(rp));

  // Check Google integration
  let gaConnected = false;
  let gscConnected = false;
  let gaMap = new Map<string, PageAnalyticsSnapshot>();
  let gscMap = new Map<string, PageSearchConsoleSnapshot>();

  if (project.googleIntegration?.encryptedRefreshToken) {
    const endDate = new Date().toISOString().split('T')[0];
    const startDateDate = new Date();
    startDateDate.setDate(startDateDate.getDate() - 28);
    const startDate = startDateDate.toISOString().split('T')[0];

    if (project.googleIntegration.gaPropertyId) {
      try {
        gaMap = await googleAnalyticsService.getPageMetrics(project, { startDate, endDate });
        gaConnected = true;
      } catch (err) {
        console.warn('[ContentPerformance] GA4 metrics fetch failed:', err);
      }
    }

    if (project.googleIntegration.gscSiteUrl) {
      try {
        gscMap = await searchConsoleService.getPageMetrics(project, { startDate, endDate });
        gscConnected = true;
      } catch (err) {
        console.warn('[ContentPerformance] GSC metrics fetch failed:', err);
      }
    }
  }

  // Merge analytics and searchConsole into each page by path or url
  for (const page of pagesMetrics) {
    if (gaConnected && gaMap.size > 0) {
      const gaSnapshot = gaMap.get(page.path) || gaMap.get(page.url) || null;
      page.analytics = gaSnapshot;
    }
    if (gscConnected && gscMap.size > 0) {
      const gscSnapshot = gscMap.get(page.path) || gscMap.get(page.url) || null;
      page.searchConsole = gscSnapshot;
    }
  }

  const pageScores = pagesMetrics.map((p) => p.seoScore);
  const avgScore = pageScores.length > 0 ? Math.round(pageScores.reduce((a, b) => a + b, 0) / pageScores.length) : 0;

  let criticalCount = 0;
  let warningCount = 0;
  const categoryCounts = new Map<string, number>();

  for (const page of pagesMetrics) {
    for (const issue of page.issues) {
      if (issue.severity === 'critical') criticalCount++;
      if (issue.severity === 'warning') warningCount++;
      categoryCounts.set(issue.category, (categoryCounts.get(issue.category) || 0) + 1);
    }
  }

  const sortedCategories = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const reportId = new mongoose.Types.ObjectId().toString();

  const report: ContentPerformanceReport = {
    reportId,
    projectId: project._id.toString(),
    crawlJobId: crawlJob._id.toString(),
    generatedAt: new Date().toISOString(),
    siteUrl: project.domain,
    overallScore: avgScore,
    pageCount: pagesMetrics.length,
    pages: pagesMetrics,
    summary: {
      avgScore,
      criticalIssueCount: criticalCount,
      warningIssueCount: warningCount,
      topIssueCategories: sortedCategories,
    },
    gaConnected,
    gscConnected,
  };

  await ContentPerformanceReportModel.create({
    _id: new mongoose.Types.ObjectId(reportId),
    projectId: report.projectId,
    crawlJobId: report.crawlJobId,
    generatedAt: new Date(report.generatedAt),
    siteUrl: report.siteUrl,
    overallScore: report.overallScore,
    pageCount: report.pageCount,
    pages: report.pages,
    summary: report.summary,
    gaConnected: report.gaConnected,
    gscConnected: report.gscConnected,
  });

  return report;
}
