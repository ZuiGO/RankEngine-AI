export type PlanId = 'free' | 'pro' | 'agency';

export interface PlanFeatures {
  audit: boolean;
  keywordTracking: boolean;
  backlinks: boolean;
  aiVisibility: boolean;
  domainOverview: boolean;
  gapAnalysis: boolean;
  contentEditor: boolean;
  keywordResearch: boolean;
  apiAccess: boolean;
  whiteLabel: boolean;
  prioritySupport: boolean;
}

export type PlanFeature = keyof PlanFeatures;

export interface PlanConfig {
  id: PlanId;
  name: string;
  price: number;
  dataProviderMonthlyLimit: number;
  projects: number;
  keywords: number;
  teamSeats: number;
  features: PlanFeatures;
  stripePriceId: string;
}

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    dataProviderMonthlyLimit: 100,
    projects: 1,
    keywords: 10,
    teamSeats: 1,
    features: {
      audit: true,
      keywordTracking: false,
      backlinks: false,
      aiVisibility: false,
      domainOverview: false,
      gapAnalysis: false,
      contentEditor: true,
      keywordResearch: false,
      apiAccess: false,
      whiteLabel: false,
      prioritySupport: false,
    },
    stripePriceId: '',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 29,
    dataProviderMonthlyLimit: 2000,
    projects: 20,
    keywords: 200,
    teamSeats: 5,
    features: {
      audit: true,
      keywordTracking: true,
      backlinks: false,
      aiVisibility: false,
      domainOverview: false,
      gapAnalysis: false,
      contentEditor: true,
      keywordResearch: true,
      apiAccess: true,
      whiteLabel: false,
      prioritySupport: false,
    },
    stripePriceId: process.env.STRIPE_PRICE_PRO || '',
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    price: 99,
    dataProviderMonthlyLimit: 10000,
    projects: 100,
    keywords: 1000,
    teamSeats: 25,
    features: {
      audit: true,
      keywordTracking: true,
      backlinks: true,
      aiVisibility: true,
      domainOverview: true,
      gapAnalysis: true,
      contentEditor: true,
      keywordResearch: true,
      apiAccess: true,
      whiteLabel: true,
      prioritySupport: true,
    },
    stripePriceId: process.env.STRIPE_PRICE_AGENCY || '',
  },
};

export function getPlanConfig(planId: string): PlanConfig {
  const plan = PLANS[planId as PlanId];
  if (!plan) return PLANS.free;
  return plan;
}

export function getFeatureFlags(planId: string): PlanFeatures {
  return getPlanConfig(planId).features;
}
