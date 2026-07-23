import mongoose from 'mongoose';
import {
  BeforeAfterComparisonReport,
  PageComparisonMetrics,
  PageComparisonChange,
  PageSeoMetrics,
  PageAnalyticsSnapshot,
  PageSearchConsoleSnapshot,
} from '@rankengine/shared-types';
import Project from '../models/Project';
import CrawlJob from '../models/CrawlJob';
import BeforeAfterComparisonReportModel from '../models/BeforeAfterComparisonReport';
import { computePageSeoMetrics } from './contentPerformanceService';
import * as googleAnalyticsService from './googleAnalyticsService';
import * as searchConsoleService from './searchConsoleService';

export function normalizePath(urlOrPath: string): string {
  if (!urlOrPath) return '/';
  let p = urlOrPath.trim();
  if (p.startsWith('http://') || p.startsWith('https://')) {
    try {
      p = new URL(p).pathname || '/';
    } catch {
      p = '/';
    }
  }
  p = p.split('?')[0].split('#')[0];
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  if (!p.startsWith('/')) {
    p = '/' + p;
  }
  return p;
}

export function diffPages(before: PageSeoMetrics, after: PageSeoMetrics): PageComparisonChange[] {
  const changes: PageComparisonChange[] = [];

  // 1. Title
  if (before.title !== after.title) {
    changes.push({
      field: 'title',
      before: before.title,
      after: after.title,
      impact: 'neutral',
    });
  }

  // 2. Title Length
  if (before.titleLength !== after.titleLength) {
    const beforeIn = before.titleLength >= 30 && before.titleLength <= 60;
    const afterIn = after.titleLength >= 30 && after.titleLength <= 60;
    let impact: 'improvement' | 'regression' | 'neutral' = 'neutral';
    if (!beforeIn && afterIn) impact = 'improvement';
    else if (beforeIn && !afterIn) impact = 'regression';

    changes.push({
      field: 'titleLength',
      before: before.titleLength,
      after: after.titleLength,
      impact,
    });
  }

  // 3. Meta Description
  if (before.metaDescription !== after.metaDescription) {
    changes.push({
      field: 'metaDescription',
      before: before.metaDescription,
      after: after.metaDescription,
      impact: 'neutral',
    });
  }

  // 4. H1 Count
  if (before.h1Count !== after.h1Count) {
    let impact: 'improvement' | 'regression' | 'neutral' = 'neutral';
    if (after.h1Count === 1 && before.h1Count !== 1) impact = 'improvement';
    else if (before.h1Count === 1 && after.h1Count !== 1) impact = 'regression';

    changes.push({
      field: 'h1Count',
      before: before.h1Count,
      after: after.h1Count,
      impact,
    });
  }

  // 5. Word Count
  if (before.wordCount !== after.wordCount) {
    const impact: 'improvement' | 'regression' | 'neutral' = after.wordCount > before.wordCount ? 'improvement' : 'regression';
    changes.push({
      field: 'wordCount',
      before: before.wordCount,
      after: after.wordCount,
      impact,
    });
  }

  // 6. Readability Score
  if (before.readabilityScore !== after.readabilityScore) {
    const impact: 'improvement' | 'regression' | 'neutral' = after.readabilityScore > before.readabilityScore ? 'improvement' : 'regression';
    changes.push({
      field: 'readabilityScore',
      before: before.readabilityScore,
      after: after.readabilityScore,
      impact,
    });
  }

  // 7. Images Missing Alt
  if (before.imagesMissingAlt !== after.imagesMissingAlt) {
    const impact: 'improvement' | 'regression' | 'neutral' = after.imagesMissingAlt < before.imagesMissingAlt ? 'improvement' : 'regression';
    changes.push({
      field: 'imagesMissingAlt',
      before: before.imagesMissingAlt,
      after: after.imagesMissingAlt,
      impact,
    });
  }

  // 8. Internal Link Count
  if (before.internalLinkCount !== after.internalLinkCount) {
    const impact: 'improvement' | 'regression' | 'neutral' = after.internalLinkCount > before.internalLinkCount ? 'improvement' : 'regression';
    changes.push({
      field: 'internalLinkCount',
      before: before.internalLinkCount,
      after: after.internalLinkCount,
      impact,
    });
  }

  // 9. Structured Data
  if (before.hasStructuredData !== after.hasStructuredData) {
    const impact: 'improvement' | 'regression' | 'neutral' = (after.hasStructuredData && !before.hasStructuredData) ? 'improvement' : 'regression';
    changes.push({
      field: 'hasStructuredData',
      before: before.hasStructuredData,
      after: after.hasStructuredData,
      impact,
    });
  }

  // 10. Indexable
  if (before.isIndexable !== after.isIndexable) {
    const impact: 'improvement' | 'regression' | 'neutral' = (after.isIndexable && !before.isIndexable) ? 'improvement' : 'regression';
    changes.push({
      field: 'isIndexable',
      before: before.isIndexable,
      after: after.isIndexable,
      impact,
    });
  }

  // 11. SEO Score
  if (before.seoScore !== after.seoScore) {
    const impact: 'improvement' | 'regression' | 'neutral' = after.seoScore > before.seoScore ? 'improvement' : 'regression';
    changes.push({
      field: 'seoScore',
      before: before.seoScore,
      after: after.seoScore,
      impact,
    });
  }

  // 12. CWV LCP
  const beforeLcp = before.cwv?.lcp;
  const afterLcp = after.cwv?.lcp;
  if (beforeLcp !== undefined && afterLcp !== undefined && beforeLcp !== afterLcp && beforeLcp !== null && afterLcp !== null) {
    const impact: 'improvement' | 'regression' | 'neutral' = afterLcp < beforeLcp ? 'improvement' : 'regression';
    changes.push({
      field: 'cwv.lcp',
      before: beforeLcp,
      after: afterLcp,
      impact,
    });
  }

  // 13. CWV INP
  const beforeInp = before.cwv?.inp;
  const afterInp = after.cwv?.inp;
  if (beforeInp !== undefined && afterInp !== undefined && beforeInp !== afterInp && beforeInp !== null && afterInp !== null) {
    const impact: 'improvement' | 'regression' | 'neutral' = afterInp < beforeInp ? 'improvement' : 'regression';
    changes.push({
      field: 'cwv.inp',
      before: beforeInp,
      after: afterInp,
      impact,
    });
  }

  // 14. CWV CLS
  const beforeCls = before.cwv?.cls;
  const afterCls = after.cwv?.cls;
  if (beforeCls !== undefined && afterCls !== undefined && beforeCls !== afterCls && beforeCls !== null && afterCls !== null) {
    const impact: 'improvement' | 'regression' | 'neutral' = afterCls < beforeCls ? 'improvement' : 'regression';
    changes.push({
      field: 'cwv.cls',
      before: beforeCls,
      after: afterCls,
      impact,
    });
  }

  return changes;
}

export function matchPages(
  oldPages: PageSeoMetrics[],
  newPages: PageSeoMetrics[],
  pathOverrides?: { oldPath: string; newPath: string }[]
): PageComparisonMetrics[] {
  const oldMap = new Map<string, PageSeoMetrics>();
  for (const p of oldPages) {
    oldMap.set(normalizePath(p.path || p.url), p);
  }

  const newMap = new Map<string, PageSeoMetrics>();
  for (const p of newPages) {
    newMap.set(normalizePath(p.path || p.url), p);
  }

  const matchedOldPaths = new Set<string>();
  const matchedNewPaths = new Set<string>();
  const results: PageComparisonMetrics[] = [];

  // Apply manual path overrides first
  if (pathOverrides && Array.isArray(pathOverrides)) {
    for (const override of pathOverrides) {
      const normOld = normalizePath(override.oldPath);
      const normNew = normalizePath(override.newPath);

      const oldPage = oldMap.get(normOld);
      const newPage = newMap.get(normNew);

      if (oldPage && newPage) {
        matchedOldPaths.add(normOld);
        matchedNewPaths.add(normNew);
        const changes = diffPages(oldPage, newPage);
        const scoreDelta = newPage.seoScore - oldPage.seoScore;

        results.push({
          path: normNew,
          oldUrl: oldPage.url,
          newUrl: newPage.url,
          matched: true,
          status: 'matched',
          before: oldPage,
          after: newPage,
          scoreDelta,
          changes,
        });
      }
    }
  }

  // Automatic matching for remaining pages
  for (const [path, oldPage] of oldMap.entries()) {
    if (matchedOldPaths.has(path)) continue;

    if (newMap.has(path) && !matchedNewPaths.has(path)) {
      const newPage = newMap.get(path)!;
      matchedOldPaths.add(path);
      matchedNewPaths.add(path);
      const changes = diffPages(oldPage, newPage);
      const scoreDelta = newPage.seoScore - oldPage.seoScore;

      results.push({
        path,
        oldUrl: oldPage.url,
        newUrl: newPage.url,
        matched: true,
        status: 'matched',
        before: oldPage,
        after: newPage,
        scoreDelta,
        changes,
      });
    } else {
      matchedOldPaths.add(path);
      results.push({
        path,
        oldUrl: oldPage.url,
        newUrl: null,
        matched: false,
        status: 'removed',
        before: oldPage,
        after: null,
        scoreDelta: null,
        changes: [],
      });
    }
  }

  // Process remaining added pages
  for (const [path, newPage] of newMap.entries()) {
    if (matchedNewPaths.has(path)) continue;

    results.push({
      path,
      oldUrl: null,
      newUrl: newPage.url,
      matched: false,
      status: 'added',
      before: null,
      after: newPage,
      scoreDelta: null,
      changes: [],
    });
  }

  return results;
}

export async function fetchPageMetricsForCrawlJob(crawlJobId: string): Promise<PageSeoMetrics[]> {
  const crawlJob = await CrawlJob.findById(crawlJobId);
  if (!crawlJob) return [];

  const db = mongoose.connection.db;
  if (!db) return [];

  let rawPages: any[] = [];
  if (crawlJob.rawResultsRef && mongoose.Types.ObjectId.isValid(crawlJob.rawResultsRef)) {
    const rawResultDoc = await db.collection('crawlresults').findOne({ _id: new mongoose.Types.ObjectId(crawlJob.rawResultsRef) });
    if (rawResultDoc && Array.isArray(rawResultDoc.pages)) {
      rawPages = rawResultDoc.pages;
    }
  }

  return rawPages.map((rp) => computePageSeoMetrics(rp));
}

export async function computeComparisonReport(params: {
  projectId: string;
  oldUrl?: string;
  newUrl?: string;
  oldCrawlJobId?: string;
  newCrawlJobId?: string;
  pathOverrides?: { oldPath: string; newPath: string }[];
}): Promise<BeforeAfterComparisonReport> {
  const project = await Project.findById(params.projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const oldSiteUrl = params.oldUrl || project.domain;
  const newSiteUrl = params.newUrl || project.stagingDomain || project.domain;

  let oldCrawlJobId = params.oldCrawlJobId;
  let newCrawlJobId = params.newCrawlJobId;

  if (!oldCrawlJobId) {
    const latestOldJob = await CrawlJob.findOne({ projectId: project._id, status: 'completed' }).sort({ completedAt: -1 });
    if (latestOldJob) {
      oldCrawlJobId = latestOldJob._id.toString();
    } else {
      throw new Error('No completed crawl job found for old URL');
    }
  }

  if (!newCrawlJobId) {
    const latestNewJob = await CrawlJob.findOne({ projectId: project._id, status: 'completed' }).sort({ completedAt: -1 });
    if (latestNewJob) {
      newCrawlJobId = latestNewJob._id.toString();
    } else {
      newCrawlJobId = oldCrawlJobId;
    }
  }

  const oldPages = await fetchPageMetricsForCrawlJob(oldCrawlJobId);
  const newPages = await fetchPageMetricsForCrawlJob(newCrawlJobId);

  // Check Google Analytics / Search Console for old site if connected
  if (project.googleIntegration?.encryptedRefreshToken) {
    const endDate = new Date().toISOString().split('T')[0];
    const startDateDate = new Date();
    startDateDate.setDate(startDateDate.getDate() - 28);
    const startDate = startDateDate.toISOString().split('T')[0];

    let gaMap = new Map<string, PageAnalyticsSnapshot>();
    let gscMap = new Map<string, PageSearchConsoleSnapshot>();

    if (project.googleIntegration.gaPropertyId) {
      try {
        gaMap = await googleAnalyticsService.getPageMetrics(project, { startDate, endDate });
      } catch (e) {
        console.warn('[ComparisonReport] GA metrics fetch failed:', e);
      }
    }

    if (project.googleIntegration.gscSiteUrl) {
      try {
        gscMap = await searchConsoleService.getPageMetrics(project, { startDate, endDate });
      } catch (e) {
        console.warn('[ComparisonReport] GSC metrics fetch failed:', e);
      }
    }

    // Attach GA/GSC to old side
    for (const page of oldPages) {
      if (gaMap.size > 0) page.analytics = gaMap.get(page.path) || gaMap.get(page.url) || null;
      if (gscMap.size > 0) page.searchConsole = gscMap.get(page.path) || gscMap.get(page.url) || null;
    }

    // Only attach GA/GSC to new side if newUrl domain actually matches gscSiteUrl / domain
    try {
      const newHost = new URL(newSiteUrl).hostname;
      const gscHost = project.googleIntegration.gscSiteUrl ? new URL(project.googleIntegration.gscSiteUrl).hostname : '';
      if (newHost === gscHost && gscHost !== '') {
        for (const page of newPages) {
          if (gaMap.size > 0) page.analytics = gaMap.get(page.path) || gaMap.get(page.url) || null;
          if (gscMap.size > 0) page.searchConsole = gscMap.get(page.path) || gscMap.get(page.url) || null;
        }
      }
    } catch {
      // Leave new side analytics/searchConsole null if host parse fails or doesn't match
    }
  }

  const comparisonPages = matchPages(oldPages, newPages, params.pathOverrides);

  const matchedPages = comparisonPages.filter((p) => p.status === 'matched');
  const pagesImproved = matchedPages.filter((p) => (p.scoreDelta || 0) > 0).length;
  const pagesRegressed = matchedPages.filter((p) => (p.scoreDelta || 0) < 0).length;
  const pagesUnchanged = matchedPages.filter((p) => (p.scoreDelta || 0) === 0).length;
  const pagesAdded = comparisonPages.filter((p) => p.status === 'added').length;
  const pagesRemoved = comparisonPages.filter((p) => p.status === 'removed').length;

  const overallScoreBefore = oldPages.length > 0 ? Math.round(oldPages.reduce((a, b) => a + b.seoScore, 0) / oldPages.length) : 0;
  const overallScoreAfter = newPages.length > 0 ? Math.round(newPages.reduce((a, b) => a + b.seoScore, 0) / newPages.length) : 0;

  const reportId = new mongoose.Types.ObjectId().toString();
  const note = 'This comparison is based on on-page and technical SEO signals. Real traffic and search performance data for the new/modified site is not yet available since it has not accrued indexing or analytics history.';

  const report: BeforeAfterComparisonReport = {
    reportId,
    projectId: project._id.toString(),
    generatedAt: new Date().toISOString(),
    oldSiteUrl,
    newSiteUrl,
    oldCrawlJobId,
    newCrawlJobId,
    overallScoreBefore,
    overallScoreAfter,
    pagesImproved,
    pagesRegressed,
    pagesUnchanged,
    pagesAdded,
    pagesRemoved,
    pages: comparisonPages,
    note,
  };

  await BeforeAfterComparisonReportModel.create({
    _id: new mongoose.Types.ObjectId(reportId),
    projectId: report.projectId,
    generatedAt: new Date(report.generatedAt),
    oldSiteUrl: report.oldSiteUrl,
    newSiteUrl: report.newSiteUrl,
    oldCrawlJobId: report.oldCrawlJobId,
    newCrawlJobId: report.newCrawlJobId,
    overallScoreBefore: report.overallScoreBefore,
    overallScoreAfter: report.overallScoreAfter,
    pagesImproved: report.pagesImproved,
    pagesRegressed: report.pagesRegressed,
    pagesUnchanged: report.pagesUnchanged,
    pagesAdded: report.pagesAdded,
    pagesRemoved: report.pagesRemoved,
    pages: report.pages,
    note: report.note,
  });

  return report;
}
