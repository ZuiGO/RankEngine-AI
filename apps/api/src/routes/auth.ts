import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import config from '../config';
import requireAuth from '../middleware/requireAuth';

const router = Router();

// Registration Validation Schema
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  role: z.enum(['agency_owner', 'marketer', 'developer'], {
    errorMap: () => ({ message: 'Role must be agency_owner, marketer, or developer' }),
  }),
  companyName: z.string().min(1, 'Company name is required'),
});

// Login Validation Schema
const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// Helper to generate JWT
const generateToken = (userId: string, role: string) => {
  return jwt.sign({ userId, role }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRY as any,
  });
};

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const validation = registerSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const { email, password, role, companyName } = validation.data;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password with bcrypt cost factor 12
    const passwordHash = await bcrypt.hash(password, 12);

    // Save user
    const user = new User({
      email,
      passwordHash,
      role,
      companyName,
    });
    await user.save();

    // Generate JWT
    const token = generateToken(user._id.toString(), user.role);

    return res.status(201).json({
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        companyName: user.companyName,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const validation = loginSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const { email, password } = validation.data;

    // Fetch user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify credentials
    const isPasswordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT
    const token = generateToken(user._id.toString(), user.role);

    return res.json({
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        companyName: user.companyName,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await User.findById(req.user.userId).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      companyName: user.companyName,
      emailDigestEnabled: user.emailDigestEnabled,
      hasCompletedOnboarding: user.hasCompletedOnboarding,
      createdAt: user.createdAt,
      dataProviderCallsThisMonth: user.dataProviderCallsThisMonth,
      dataProviderMonthlyLimit: user.dataProviderMonthlyLimit,
      dataProviderQuotaResetAt: user.dataProviderQuotaResetAt,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/auth/onboarding-complete
router.patch('/onboarding-complete', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { hasCompletedOnboarding: true },
      { new: true }
    ).select('-passwordHash');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      companyName: user.companyName,
      emailDigestEnabled: user.emailDigestEnabled,
      hasCompletedOnboarding: user.hasCompletedOnboarding,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error('Onboarding complete error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/auth/preferences - Update user preferences
const preferencesSchema = z.object({
  emailDigestEnabled: z.boolean(),
});

router.patch('/preferences', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const validation = preferencesSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { emailDigestEnabled: validation.data.emailDigestEnabled },
      { new: true }
    ).select('-passwordHash');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      companyName: user.companyName,
      emailDigestEnabled: user.emailDigestEnabled,
      hasCompletedOnboarding: user.hasCompletedOnboarding,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
