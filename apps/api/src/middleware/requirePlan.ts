import { Request, Response, NextFunction } from 'express';
import User from '../models/User';
import { getFeatureFlags, type PlanFeature } from '../config/plans';

const FEATURE_LABELS: Record<PlanFeature, string> = {
  audit: 'Site Audits & Migration Checks',
  keywordTracking: 'Keyword Rank Tracking',
  keywordResearch: 'Keyword Research',
  backlinks: 'Backlink Analysis',
  aiVisibility: 'AI Visibility Monitoring',
  domainOverview: 'Domain Overview',
  gapAnalysis: 'Competitor Gap Analysis',
  contentEditor: 'Content Editor',
  apiAccess: 'API Access',
  whiteLabel: 'White-Label Reports',
  prioritySupport: 'Priority Support',
};

export function requirePlan(...requiredFeatures: PlanFeature[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const user = await User.findById(req.user.userId).select('planId subscriptionStatus');

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      const planId = user.planId || 'free';
      const features = getFeatureFlags(planId);

      for (const feature of requiredFeatures) {
        if (!features[feature]) {
          const label = FEATURE_LABELS[feature] || feature;
          return res.status(402).json({
            error: `Your current plan does not include ${label}.`,
            code: 'UPGRADE_REQUIRED',
            feature: label,
            planId,
            requiredPlan: planId === 'free' ? 'pro' : 'agency',
          });
        }
      }

      next();
    } catch (error) {
      console.error('requirePlan middleware error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}
