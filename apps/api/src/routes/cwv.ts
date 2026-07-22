import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Project } from '../models/Project';
import { callGroq, LlmError } from '../services/llmService';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

interface CwvMetrics {
  lcp: { value: number; rating: 'good' | 'needs-improvement' | 'poor' };
  inp: { value: number; rating: 'good' | 'needs-improvement' | 'poor' };
  cls: { value: number; rating: 'good' | 'needs-improvement' | 'poor' };
  fcp: { value: number; rating: 'good' | 'needs-improvement' | 'poor' };
  ttfb: { value: number; rating: 'good' | 'needs-improvement' | 'poor' };
}

function parseMs(value: number): string {
  return `${(value / 1000).toFixed(2)}s`;
}

function parseScore(value: number): string {
  return value.toFixed(3);
}

function getRating(value: number, type: 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb'): 'good' | 'needs-improvement' | 'poor' {
  const thresholds: Record<string, { good: number; poor: number }> = {
    lcp: { good: 2500, poor: 4000 },
    inp: { good: 200, poor: 500 },
    cls: { good: 0.1, poor: 0.25 },
    fcp: { good: 1800, poor: 3000 },
    ttfb: { good: 800, poor: 1800 },
  };
  const t = thresholds[type];
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'needs-improvement';
  return 'poor';
}

router.get('/:id/cwv', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const domain = project.domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    // Attempt PageSpeed Insights API
    let psiData: any = null;
    let psiError: string | null = null;
    try {
      const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://${domain}&strategy=mobile&category=performance`;
      const response = await fetch(psiUrl, { signal: AbortSignal.timeout(15000) });
      if (response.ok) {
        psiData = await response.json();
      } else {
        psiError = `PageSpeed API returned ${response.status}`;
      }
    } catch (e: any) {
      psiError = e?.message || 'PageSpeed API request failed';
    }

    // Build metrics from PSI data or use LLM estimation
    let metrics: CwvMetrics;
    let recommendations: string[] = [];
    let indexingStatus: { accessible: boolean; robotsBlocked: boolean; hasSitemap: boolean; metaRobots: string | null } = {
      accessible: true,
      robotsBlocked: false,
      hasSitemap: false,
      metaRobots: null,
    };

    if (psiData && psiData.lighthouseResult) {
      const audits = psiData.lighthouseResult.audits || {};
      const lcpAudit = audits['largest-contentful-paint'];
      const inpAudit = audits['interaction-to-next-paint'] || audits['max-potential-fid'];
      const clsAudit = audits['cumulative-layout-shift'];
      const fcpAudit = audits['first-contentful-paint'];
      const ttfbAudit = audits['server-response-time'] || audits['time-to-first-byte'];
      const diagnostics = psiData.lighthouseResult.audits?.['diagnostics']?.details?.items?.[0] || {};

      metrics = {
        lcp: { value: lcpAudit?.numericValue || 3000, rating: getRating(lcpAudit?.numericValue || 3000, 'lcp') },
        inp: { value: inpAudit?.numericValue || 300, rating: getRating(inpAudit?.numericValue || 300, 'inp') },
        cls: { value: clsAudit?.numericValue || 0.15, rating: getRating(clsAudit?.numericValue || 0.15, 'cls') },
        fcp: { value: fcpAudit?.numericValue || 2000, rating: getRating(fcpAudit?.numericValue || 2000, 'fcp') },
        ttfb: { value: ttfbAudit?.numericValue || 1000, rating: getRating(ttfbAudit?.numericValue || 1000, 'ttfb') },
      };

      // Extract recommendations from Lighthouse audits
      recommendations = Object.values(audits)
        .filter((a: any) => a.score !== null && a.score < 0.9 && a.title)
        .slice(0, 10)
        .map((a: any) => a.title);

      indexingStatus = {
        accessible: true,
        robotsBlocked: false,
        hasSitemap: false,
        metaRobots: 'index, follow',
      };
    } else {
      // Fallback: Estimate with LLM
      const prompt = `You are a Core Web Vitals analyst. Based on your knowledge of typical web performance, estimate the metrics for ${domain}.

Return valid JSON with this exact schema:
{
  "lcp": number (largest contentful paint in ms, typical range 1500-6000),
  "inp": number (interaction to next paint in ms, typical range 50-600),
  "cls": number (cumulative layout shift, typical range 0.01-0.5),
  "fcp": number (first contentful paint in ms, typical range 1000-4000),
  "ttfb": number (time to first byte in ms, typical range 200-3000),
  "recommendations": ["string (3-5 actionable improvement suggestions specific to this domain)"]
}

Provide realistic estimates. If this is a well-known site, use known benchmarks. If unknown, provide conservative mid-range estimates.`;

      const estimation = await callGroq<{
        lcp: number;
        inp: number;
        cls: number;
        fcp: number;
        ttfb: number;
        recommendations: string[];
      }>(prompt, 20000);

      metrics = {
        lcp: { value: estimation.lcp, rating: getRating(estimation.lcp, 'lcp') },
        inp: { value: estimation.inp, rating: getRating(estimation.inp, 'inp') },
        cls: { value: estimation.cls, rating: getRating(estimation.cls, 'cls') },
        fcp: { value: estimation.fcp, rating: getRating(estimation.fcp, 'fcp') },
        ttfb: { value: estimation.ttfb, rating: getRating(estimation.ttfb, 'ttfb') },
      };
      recommendations = estimation.recommendations || [];
    }

    // Overall score (simplified Lighthouse-like scoring)
    const overallScore = Math.round(
      (metrics.lcp.rating === 'good' ? 25 : metrics.lcp.rating === 'needs-improvement' ? 15 : 5) +
      (metrics.inp.rating === 'good' ? 25 : metrics.inp.rating === 'needs-improvement' ? 15 : 5) +
      (metrics.cls.rating === 'good' ? 25 : metrics.cls.rating === 'needs-improvement' ? 15 : 5) +
      (metrics.fcp.rating === 'good' ? 15 : metrics.fcp.rating === 'needs-improvement' ? 10 : 5) +
      (metrics.ttfb.rating === 'good' ? 10 : metrics.ttfb.rating === 'needs-improvement' ? 5 : 0)
    );

    return res.json({
      url: `https://${domain}`,
      overallScore,
      metrics,
      recommendations,
      indexingStatus,
      source: psiData ? 'pagespeed-api' : 'estimation',
      psiError,
    });
  } catch (error) {
    if (error instanceof LlmError) {
      return res.status(502).json({ error: error.message });
    }
    console.error('[CWV] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
