import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import mongoose from 'mongoose';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import requireAuth from '../middleware/requireAuth';
import { requirePlan } from '../middleware/requirePlan';
import { Organization } from '../models/Organization';
import { Membership } from '../models/Membership';
import { TeamInvite } from '../models/TeamInvite';
import { User } from '../models/User';
import { getEmailService } from '../services/emailService';
import { saveFile, getFileUrl, generateFilename } from '../services/storageService';
import config from '../config';
import { getPlanConfig } from '../config/plans';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

/*
 * Helpers
 */

async function getOrg(orgId: string) {
  if (!isValidObjectId(orgId)) return null;
  return Organization.findById(orgId);
}

async function requireOrgAccess(
  orgId: string,
  userId: string,
  allowedRoles: string[] = ['owner', 'admin']
) {
  const membership = await Membership.findOne({ organizationId: orgId, userId });
  if (!membership || !allowedRoles.includes(membership.role)) return null;
  return membership;
}

async function getOrgOwnerPlan(orgId: string): Promise<string> {
  const org = await Organization.findById(orgId);
  if (!org) return 'free';
  const user = await User.findById(org.ownerId);
  return user?.planId ?? 'free';
}

async function countAcceptedMembers(orgId: string): Promise<number> {
  return Membership.countDocuments({ organizationId: orgId, joinedAt: { $ne: null } });
}

/*
 * POST /api/organizations/:orgId/invites — invite a teammate by email
 */
const inviteSchema = z.object({
  email: z
    .string()
    .email()
    .transform((e) => e.toLowerCase().trim()),
  role: z.enum(['admin', 'member']).default('member'),
});

router.post('/:orgId/invites', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const org = await getOrg(req.params.orgId);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const callerMembership = await requireOrgAccess(req.params.orgId, req.user.userId);
    if (!callerMembership) {
      return res
        .status(403)
        .json({ error: 'Forbidden: Only organization owners and admins can invite members' });
    }

    const validation = inviteSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
    }

    const { email, role } = validation.data;

    // Don't allow inviting yourself
    const currentUser = await User.findById(req.user.userId);
    if (currentUser && currentUser.email === email) {
      return res.status(400).json({ error: 'You cannot invite yourself' });
    }

    // Check plan seat limit using org owner's plan
    const planId = await getOrgOwnerPlan(req.params.orgId);
    const plan = getPlanConfig(planId);
    const currentMembers = await countAcceptedMembers(req.params.orgId);
    const pendingCount = await TeamInvite.countDocuments({
      organizationId: new mongoose.Types.ObjectId(req.params.orgId),
      status: 'pending',
    });
    if (currentMembers + pendingCount >= plan.teamSeats) {
      return res.status(403).json({
        error: `Team seat limit reached for the ${plan.name} plan (${plan.teamSeats} seats). Upgrade to add more members.`,
      });
    }

    // Check for existing pending invite for this email in this org
    const existingInvite = await TeamInvite.findOne({
      organizationId: new mongoose.Types.ObjectId(req.params.orgId),
      email,
      status: 'pending',
    });
    if (existingInvite) {
      return res.status(409).json({ error: 'An active invitation already exists for this email' });
    }

    // Check if user is already a member
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      const existingMembership = await Membership.findOne({
        organizationId: new mongoose.Types.ObjectId(req.params.orgId),
        userId: existingUser._id,
      });
      if (existingMembership) {
        return res.status(409).json({ error: 'User is already a member of this organization' });
      }
    }

    // Create invite record
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await TeamInvite.create({
      organizationId: new mongoose.Types.ObjectId(req.params.orgId),
      invitedBy: new mongoose.Types.ObjectId(req.user.userId),
      email,
      role,
      token,
      expiresAt,
      status: 'pending',
    });

    // If user exists, pre-create the membership (joinedAt stays null until accept)
    if (existingUser) {
      await Membership.create({
        organizationId: new mongoose.Types.ObjectId(req.params.orgId),
        userId: existingUser._id,
        role,
        invitedAt: new Date(),
        joinedAt: null,
      });
    }

    // Send invite email
    const acceptUrl = `${config.CORS_ORIGIN}/invites/${token}/accept`;
    const emailService = getEmailService();
    const orgName = org.name;
    const inviterName = currentUser?.companyName || currentUser?.email || 'A team member';
    await emailService.sendEmail(
      email,
      `You've been invited to join ${orgName} on RankEngine AI`,
      [
        `Hello,`,
        ``,
        `${inviterName} has invited you to join "${orgName}" on RankEngine AI.`,
        ``,
        existingUser
          ? `Click the link below to accept the invitation:`
          : `Click the link below to create your account and join the organization:`,
        ``,
        acceptUrl,
        ``,
        `This invitation expires in 7 days.`,
        ``,
        `— RankEngine AI Team`,
      ].join('\n')
    );

    return res.status(201).json({
      message: 'Invitation sent',
      email,
      role,
      token,
      expiresAt,
    });
  } catch (error) {
    console.error('[Organizations] Invite error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * POST /api/invites/:token/accept — accept an invitation
 */
router.post('/invites/:token/accept', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { token } = req.params;
    const invite = await TeamInvite.findOne({ token, status: 'pending' });
    if (!invite) {
      return res.status(404).json({ error: 'Invitation not found or already accepted' });
    }

    if (invite.expiresAt < new Date()) {
      invite.status = 'expired';
      await invite.save();
      return res.status(410).json({ error: 'Invitation has expired' });
    }

    // Verify the authenticated user matches the invited email
    const user = await User.findById(req.user.userId);
    if (!user || user.email.toLowerCase() !== invite.email) {
      return res
        .status(403)
        .json({ error: 'This invitation was sent to a different email address' });
    }

    // Upsert membership — handles both pre-created (user existed at invite time)
    // and newly created (user registered after invite) cases
    const membership = await Membership.findOneAndUpdate(
      { organizationId: invite.organizationId, userId: user._id },
      {
        organizationId: invite.organizationId,
        userId: user._id,
        role: invite.role,
        joinedAt: new Date(),
        $setOnInsert: { invitedAt: new Date() },
      },
      { upsert: true, new: true }
    );

    invite.status = 'accepted';
    await invite.save();

    // Look up org name for the response
    const org = await Organization.findById(invite.organizationId);

    return res.json({
      message: 'Invitation accepted',
      organizationId: invite.organizationId.toString(),
      organizationName: org?.name ?? 'Unknown',
      role: membership.role,
    });
  } catch (error) {
    console.error('[Organizations] Accept invite error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * GET /api/organizations/:orgId/members — list members + pending invites
 */
router.get('/:orgId/members', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const org = await getOrg(req.params.orgId);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const callerMembership = await requireOrgAccess(req.params.orgId, req.user.userId);
    if (!callerMembership) {
      return res
        .status(403)
        .json({ error: 'Forbidden: Only organization members can view team members' });
    }

    // Fetch members with user data
    const memberships = await Membership.find({
      organizationId: new mongoose.Types.ObjectId(req.params.orgId),
    }).lean();

    const userIds = memberships.map((m) => m.userId);
    const users = await User.find({ _id: { $in: userIds } })
      .select('email companyName role')
      .lean();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const members = memberships.map((m) => {
      const u = userMap.get(m.userId.toString());
      return {
        userId: m.userId.toString(),
        email: u?.email ?? 'unknown',
        companyName: u?.companyName ?? '',
        role: m.role,
        joinedAt: m.joinedAt,
        invitedAt: m.invitedAt,
      };
    });

    // Fetch pending invites
    const invites = await TeamInvite.find({
      organizationId: new mongoose.Types.ObjectId(req.params.orgId),
      status: 'pending',
    })
      .select('email role token expiresAt createdAt')
      .lean();

    return res.json({ members, invites });
  } catch (error) {
    console.error('[Organizations] List members error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * DELETE /api/organizations/:orgId/members/:userId — remove a member
 */
router.delete('/:orgId/members/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const org = await getOrg(req.params.orgId);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const callerMembership = await requireOrgAccess(req.params.orgId, req.user.userId);
    if (!callerMembership) {
      return res
        .status(403)
        .json({ error: 'Forbidden: Only owners and admins can remove members' });
    }

    if (!isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    const targetMembership = await Membership.findOne({
      organizationId: new mongoose.Types.ObjectId(req.params.orgId),
      userId: new mongoose.Types.ObjectId(req.params.userId),
    });
    if (!targetMembership) {
      return res.status(404).json({ error: 'Member not found in this organization' });
    }

    // Prevent removing the last owner
    if (targetMembership.role === 'owner') {
      const ownerCount = await Membership.countDocuments({
        organizationId: new mongoose.Types.ObjectId(req.params.orgId),
        role: 'owner',
      });
      if (ownerCount <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last owner of the organization' });
      }
    }

    await Membership.findByIdAndDelete(targetMembership._id);

    // Also expire any pending invites for this user
    const user = await User.findById(req.params.userId);
    if (user) {
      await TeamInvite.updateMany(
        {
          organizationId: new mongoose.Types.ObjectId(req.params.orgId),
          email: user.email,
          status: 'pending',
        },
        { status: 'expired' }
      );
    }

    return res.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error('[Organizations] Remove member error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * GET /api/organizations — list organizations for the authenticated user
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    // Find all orgs the user is a member of
    const memberships = await Membership.find({ userId: req.user.userId }).lean();
    const orgIds = memberships.map((m) => m.organizationId);

    const orgs = await Organization.find({ _id: { $in: orgIds } })
      .select('name ownerId logoUrl primaryColor reportFooterText createdAt')
      .lean();

    return res.json(orgs);
  } catch (error) {
    console.error('[Organizations] List error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * GET /api/organizations/:orgId — get organization details (including branding)
 */
router.get('/:orgId', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const org = await getOrg(req.params.orgId);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const membership = await requireOrgAccess(req.params.orgId, req.user.userId);
    if (!membership) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return res.json({
      _id: org._id,
      name: org.name,
      ownerId: org.ownerId,
      createdAt: org.createdAt,
      logoUrl: org.logoUrl || null,
      primaryColor: org.primaryColor || null,
      reportFooterText: org.reportFooterText || null,
    });
  } catch (error) {
    console.error('[Organizations] Get error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Multer setup for logo upload ────────────────────────────────────────
const logoUpload = multer({
  dest: path.resolve(config.STORAGE_PATH),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPEG, WebP, and SVG images are allowed'));
    }
  },
});

/*
 * POST /api/organizations/:orgId/branding — update branding (Agency plan only)
 *
 * multipart/form-data fields:
 *   - logo (file, optional)
 *   - primaryColor (string, optional, hex color)
 *   - reportFooterText (string, optional, max 500 chars)
 */
router.post(
  '/:orgId/branding',
  requireAuth,
  requirePlan('whiteLabel'),
  logoUpload.single('logo'),
  async (req: Request, res: Response) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

      const org = await getOrg(req.params.orgId);
      if (!org) return res.status(404).json({ error: 'Organization not found' });

      const membership = await requireOrgAccess(req.params.orgId, req.user.userId);
      if (!membership) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Only owners and admins can update branding' });
      }

      const update: Record<string, string | undefined> = {};

      // Handle logo file upload
      if (req.file) {
        const filename = generateFilename(req.file.originalname);
        const savedPath = saveFile(require('fs').readFileSync(req.file.path), filename);
        // Clean up multer's temp file
        try {
          require('fs').unlinkSync(req.file.path);
        } catch {
          /* ignore */
        }
        update.logoUrl = getFileUrl(savedPath);
      }

      // Handle color
      if (req.body.primaryColor !== undefined) {
        const color = String(req.body.primaryColor).trim();
        if (color === '') {
          update.primaryColor = '';
        } else if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
          return res
            .status(400)
            .json({ error: 'primaryColor must be a valid hex color (e.g. #4f46e5)' });
        } else {
          update.primaryColor = color;
        }
      }

      // Handle footer text
      if (req.body.reportFooterText !== undefined) {
        const text = String(req.body.reportFooterText).trim();
        if (text.length > 500) {
          return res
            .status(400)
            .json({ error: 'reportFooterText must be 500 characters or fewer' });
        }
        update.reportFooterText = text;
      }

      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: 'No branding fields provided' });
      }

      const updated = await Organization.findByIdAndUpdate(
        req.params.orgId,
        { $set: update },
        { new: true }
      ).select('name logoUrl primaryColor reportFooterText');

      return res.json({ message: 'Branding updated', organization: updated });
    } catch (error: any) {
      if (error?.message?.includes('Only PNG, JPEG, WebP')) {
        return res.status(400).json({ error: error.message });
      }
      console.error('[Organizations] Branding error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
