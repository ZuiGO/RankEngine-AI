import { Router, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import requireAuth from '../middleware/requireAuth';
import { requirePlan } from '../middleware/requirePlan';
import { Project } from '../models/Project';
import { Membership } from '../models/Membership';
import {
  getDomainOverview,
  getReferringDomains,
  DataProviderQuotaError,
} from '../services/dataProviderService';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

const resolveProject = async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const { id } = req.params;
  if (!isValidObjectId(id)) {
    res.status(400).json({ error: 'Invalid project ID format' });
    return null;
  }
  const project = await Project.findOne({ _id: id, deletedAt: null });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  const membership = await Membership.findOne({
    organizationId: project.organizationId,
    userId: req.user.userId,
  });
  if (!membership) {
    res.status(403).json({ error: 'Forbidden: You do not own this project' });
    return null;
  }
  return project;
};

const competitorsSchema = z.object({
  competitors: z.array(z.string().min(1).max(500)).min(1).max(5),
});

// POST /api/projects/:id/keyword-gap
router.post(
  '/:id/keyword-gap',
  requireAuth,
  requirePlan('gapAnalysis'),
  async (req: Request, res: Response) => {
    try {
      const project = await resolveProject(req, res);
      if (!project) return;

      const validation = competitorsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.flatten().fieldErrors,
        });
      }

      const domains = [project.domain, ...validation.data.competitors];

      const { default: pLimit } = await import('p-limit');
      const limit = pLimit(3);
      const results = await Promise.all(
        domains.map((domain) =>
          limit(async () => {
            try {
              const data = await getDomainOverview(req.user!.userId, domain);
              return { domain, keywords: data.topKeywords.map((k) => k.keyword) };
            } catch {
              return { domain, keywords: [] };
            }
          })
        )
      );

      const projectEntry = results[0];
      const projectKeywords = new Set(projectEntry.keywords);
      const competitorEntries = results.slice(1);

      const allCompetitorKeywordSets = competitorEntries
        .filter((e) => e.keywords.length > 0)
        .map((e) => new Set(e.keywords));

      const competitorCount = allCompetitorKeywordSets.length;

      const keywordDomainMap: Record<string, string[]> = {};
      for (const entry of competitorEntries) {
        for (const kw of entry.keywords) {
          if (!keywordDomainMap[kw]) keywordDomainMap[kw] = [];
          keywordDomainMap[kw].push(entry.domain);
        }
      }

      const yourAdvantage: string[] = [];
      const gapOpportunities: { keyword: string; rankCount: number; domains: string[] }[] = [];
      const partialOverlap: { keyword: string; rankCount: number; domains: string[] }[] = [];

      for (const kw of projectKeywords) {
        const domainsWithKw = keywordDomainMap[kw] ?? [];
        if (domainsWithKw.length === 0) {
          yourAdvantage.push(kw);
        }
      }

      if (competitorCount > 0) {
        const allCompetitorKeywords = new Set<string>();
        for (const set of allCompetitorKeywordSets) {
          for (const kw of set) {
            allCompetitorKeywords.add(kw);
          }
        }

        for (const kw of allCompetitorKeywords) {
          if (projectKeywords.has(kw)) continue;
          const domainsWithKw = keywordDomainMap[kw] ?? [];
          const entry = { keyword: kw, rankCount: domainsWithKw.length, domains: domainsWithKw };
          if (domainsWithKw.length === competitorCount) {
            gapOpportunities.push(entry);
          } else {
            partialOverlap.push(entry);
          }
        }
      }

      gapOpportunities.sort((a, b) => b.rankCount - a.rankCount);
      partialOverlap.sort((a, b) => b.rankCount - a.rankCount);

      return res.json({
        projectDomain: project.domain,
        competitors: validation.data.competitors,
        yourAdvantage,
        gapOpportunities,
        partialOverlap,
        gapOpportunityCount: gapOpportunities.length,
        totalCompetitorsQueried: competitorEntries.length,
      });
    } catch (error) {
      if (error instanceof DataProviderQuotaError) {
        return res.status(429).json({
          error: error.message,
          retryAfterMs: error.retryAfterMs,
        });
      }
      console.error('[KeywordGap] error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /api/projects/:id/backlink-gap
router.post(
  '/:id/backlink-gap',
  requireAuth,
  requirePlan('gapAnalysis'),
  async (req: Request, res: Response) => {
    try {
      const project = await resolveProject(req, res);
      if (!project) return;

      const validation = competitorsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validation.error.flatten().fieldErrors,
        });
      }

      const domains = [project.domain, ...validation.data.competitors];

      const { default: pLimit } = await import('p-limit');
      const limit = pLimit(3);
      const results = await Promise.all(
        domains.map((domain) =>
          limit(async () => {
            try {
              const domains_list = await getReferringDomains(req.user!.userId, domain);
              return { domain, referringDomains: domains_list };
            } catch {
              return { domain, referringDomains: [] };
            }
          })
        )
      );

      const projectEntry = results[0];
      const projectReferringDomains = new Set(
        projectEntry.referringDomains.map((d) => d.toLowerCase())
      );

      const competitorEntries = results.slice(1);
      const allCompetitorDomains = new Set<string>();
      const competitorDomainMap: Record<string, Set<string>> = {};
      for (const entry of competitorEntries) {
        const domainSet = new Set(entry.referringDomains.map((d) => d.toLowerCase()));
        competitorDomainMap[entry.domain] = domainSet;
        for (const d of domainSet) {
          allCompetitorDomains.add(d);
        }
      }

      const linkOpportunities: { domain: string; linkedBy: string[] }[] = [];

      for (const refDomain of allCompetitorDomains) {
        if (projectReferringDomains.has(refDomain)) continue;
        const linkedBy: string[] = [];
        for (const entry of competitorEntries) {
          if (competitorDomainMap[entry.domain]?.has(refDomain)) {
            linkedBy.push(entry.domain);
          }
        }
        if (linkedBy.length > 0) {
          linkOpportunities.push({ domain: refDomain, linkedBy });
        }
      }

      linkOpportunities.sort((a, b) => b.linkedBy.length - a.linkedBy.length);

      return res.json({
        projectDomain: project.domain,
        competitors: validation.data.competitors,
        linkOpportunities,
        linkOpportunityCount: linkOpportunities.length,
        totalCompetitorsQueried: competitorEntries.length,
      });
    } catch (error) {
      if (error instanceof DataProviderQuotaError) {
        return res.status(429).json({
          error: error.message,
          retryAfterMs: error.retryAfterMs,
        });
      }
      console.error('[BacklinkGap] error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
