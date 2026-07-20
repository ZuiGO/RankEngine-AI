import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import Subscription, { getPlanLimits, SubscriptionPlan } from '../models/Subscription';
import TeamInvite from '../models/TeamInvite';
import Organization from '../models/Organization';
import User from '../models/User';
import requireAuth from '../middleware/requireAuth';
import config from '../config';
import { getPlanConfig, type PlanId, PLANS } from '../config/plans';
import {
  createOrRetrieveCustomer,
  createCheckoutSession,
  createPortalSession,
} from '../services/stripeService';

const router = Router();

// GET /api/billing/plans (public — no auth required)
router.get('/plans', (_req: Request, res: Response) => {
  const plans = Object.values(PLANS).map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    dataProviderMonthlyLimit: p.dataProviderMonthlyLimit,
    projects: p.projects,
    keywords: p.keywords,
    teamSeats: p.teamSeats,
    features: p.features,
    hasPrice: !!p.stripePriceId,
  }));
  res.json(plans);
});

router.use(requireAuth);

// GET /api/billing/subscription
router.get('/subscription', async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const plan = getPlanConfig(user.planId);

    let sub = await Subscription.findOne({ ownerId: req.user.userId });

    res.json({
      plan: user.planId,
      planName: plan.name,
      status: user.subscriptionStatus,
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId,
      dataProviderMonthlyLimit: user.dataProviderMonthlyLimit,
      projects: plan.projects,
      keywords: plan.keywords,
      seats: plan.teamSeats,
      features: plan.features,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/billing/subscription (legacy direct plan change without payment)
const updatePlanSchema = z.object({
  plan: z.enum(['free', 'starter', 'professional', 'agency']),
});

router.patch('/subscription', async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const validation = updatePlanSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const { plan } = validation.data;
    const limits = getPlanLimits(plan);

    let sub = await Subscription.findOne({ ownerId: req.user.userId });
    if (!sub) {
      sub = new Subscription({ ownerId: req.user.userId, plan });
    } else {
      sub.plan = plan;
    }
    await sub.save();

    await User.findByIdAndUpdate(req.user.userId, {
      dataProviderMonthlyLimit: limits.dataProviderMonthlyLimit,
    });

    res.json({
      plan: sub.plan,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      ...limits,
    });
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/billing/create-checkout-session
const checkoutSchema = z.object({
  planId: z.enum(['free', 'pro', 'agency']),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

router.post('/create-checkout-session', async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const validation = checkoutSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const { planId, successUrl, cancelUrl } = validation.data;

    if (planId === 'free') {
      return res.status(400).json({ error: 'Free plan does not require a checkout session' });
    }

    const plan = getPlanConfig(planId);
    if (!plan.stripePriceId) {
      return res.status(500).json({ error: `No Stripe price configured for plan "${planId}"` });
    }

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const customerId = await createOrRetrieveCustomer(
      req.user.userId,
      user.email,
      user.stripeCustomerId,
    );

    const sessionUrl = await createCheckoutSession(
      customerId,
      planId,
      successUrl || `${config.CORS_ORIGIN}/settings/billing?success=1`,
      cancelUrl || `${config.CORS_ORIGIN}/settings/billing?canceled=1`,
    );

    // Persist the Stripe customer ID immediately so future calls reuse it
    if (!user.stripeCustomerId) {
      await User.findByIdAndUpdate(req.user.userId, { stripeCustomerId: customerId });
    }

    res.json({ url: sessionUrl });
  } catch (error) {
    console.error('Create checkout session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/billing/portal-session
router.get('/portal-session', async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: 'No Stripe customer found. Subscribe first.' });
    }

    const returnUrl = `${config.CORS_ORIGIN}/settings/billing`;
    const portalUrl = await createPortalSession(user.stripeCustomerId, returnUrl);

    res.json({ url: portalUrl });
  } catch (error) {
    console.error('Create portal session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/billing/invite
const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['member', 'admin']).default('member'),
});

router.post('/invite', async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const validation = inviteSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const { email, role } = validation.data;

    const sub = await Subscription.findOne({ ownerId: req.user.userId });
    const limits = getPlanLimits(sub?.plan ?? 'free');
    const pendingCount = await TeamInvite.countDocuments({ invitedBy: req.user.userId, status: 'pending' });
    if (pendingCount >= limits.seats) {
      return res.status(403).json({ error: 'Team seat limit reached for your plan' });
    }

    const existing = await TeamInvite.findOne({ invitedBy: req.user.userId, email, status: 'pending' });
    if (existing) {
      return res.status(409).json({ error: 'Invite already sent to this email' });
    }

    const org = await Organization.findOne({ ownerId: req.user.userId });
    if (!org) {
      return res.status(400).json({ error: 'No organization found' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = new TeamInvite({
      organizationId: org._id,
      invitedBy: req.user.userId,
      email,
      role,
      token,
      expiresAt,
    });
    await invite.save();

    res.status(201).json({ message: 'Invite sent', email, token });
  } catch (error) {
    console.error('Invite error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/billing/team
router.get('/team', async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const invites = await TeamInvite.find({ invitedBy: req.user.userId }).sort({ createdAt: -1 });
    res.json(invites);
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
