import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import Subscription, { getPlanLimits, SubscriptionPlan } from '../models/Subscription';
import TeamInvite from '../models/TeamInvite';
import User from '../models/User';
import requireAuth from '../middleware/requireAuth';

const router = Router();

router.use(requireAuth);

const PLANS: { id: SubscriptionPlan; name: string; price: number; features: string[] }[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    features: ['1 project', '10 keywords', '1 team seat', '100 data API calls/mo'],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 29,
    features: ['5 projects', '50 keywords', '2 team seats', '500 data API calls/mo'],
  },
  {
    id: 'professional',
    name: 'Professional',
    price: 79,
    features: ['20 projects', '200 keywords', '5 team seats', '2,000 data API calls/mo'],
  },
  {
    id: 'agency',
    name: 'Agency',
    price: 199,
    features: ['100 projects', '1,000 keywords', '25 team seats', '10,000 data API calls/mo'],
  },
];

// GET /api/billing/plans
router.get('/plans', (_req: Request, res: Response) => {
  res.json(PLANS);
});

// GET /api/billing/subscription
router.get('/subscription', async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    let sub = await Subscription.findOne({ ownerId: req.user.userId });
    if (!sub) {
      sub = new Subscription({ ownerId: req.user.userId });
      await sub.save();
    }

    const limits = getPlanLimits(sub.plan);
    res.json({
      plan: sub.plan,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      ...limits,
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/billing/subscription
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
    const pendingCount = await TeamInvite.countDocuments({ ownerId: req.user.userId, status: 'pending' });
    if (pendingCount >= limits.seats) {
      return res.status(403).json({ error: 'Team seat limit reached for your plan' });
    }

    const existing = await TeamInvite.findOne({ ownerId: req.user.userId, email, status: 'pending' });
    if (existing) {
      return res.status(409).json({ error: 'Invite already sent to this email' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = new TeamInvite({
      ownerId: req.user.userId,
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

    const invites = await TeamInvite.find({ ownerId: req.user.userId }).sort({ createdAt: -1 });
    res.json(invites);
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
