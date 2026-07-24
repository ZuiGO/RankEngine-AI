import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import axios from 'axios';
import { z } from 'zod';
import { GoogleIntegrationStatus } from '@rankengine/shared-types';
import config from '../config';
import Project from '../models/Project';
import { encryptToken, decryptToken, getFreshAccessToken } from '../services/googleTokenService';
import { paidApiRateLimiter } from '../middleware/rateLimiter';

const router = Router();
const isValidObjectId = (id: string) => mongoose.Types.ObjectId.isValid(id);

/**
 * Sign OAuth state containing projectId to prevent state tampering / CSRF attacks.
 */
export function signOAuthState(projectId: string): string {
  const secret = config.GOOGLE_TOKEN_ENCRYPTION_KEY || 'default-oauth-state-signing-secret';
  const timestamp = Date.now().toString();
  const hmac = crypto.createHmac('sha256', secret).update(`${projectId}:${timestamp}`).digest('hex');
  return `${projectId}.${timestamp}.${hmac}`;
}

/**
 * Verify signed OAuth state string. Returns { projectId } if valid signature, null otherwise.
 */
export function verifyOAuthState(state: string): { projectId: string } | null {
  if (!state || typeof state !== 'string') return null;
  const parts = state.split('.');
  if (parts.length !== 3) return null;

  const [projectId, timestamp, hmac] = parts;
  const secret = config.GOOGLE_TOKEN_ENCRYPTION_KEY || 'default-oauth-state-signing-secret';
  const expectedHmac = crypto.createHmac('sha256', secret).update(`${projectId}:${timestamp}`).digest('hex');

  try {
    const bufHmac = Buffer.from(hmac, 'hex');
    const bufExpected = Buffer.from(expectedHmac, 'hex');
    if (bufHmac.length === bufExpected.length && crypto.timingSafeEqual(bufHmac, bufExpected)) {
      return { projectId };
    }
  } catch {
    return null;
  }
  return null;
}

// ── GET /api/integrations/google/connect ────────────────────────────────────
router.get(['/integrations/google/connect', '/connect'], async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string;
    if (!projectId || !isValidObjectId(projectId)) {
      return res.status(400).json({ error: 'Valid projectId query parameter is required' });
    }

    const project = await Project.findOne({ _id: projectId, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const signedState = signOAuthState(projectId);
    const scopes = [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/webmasters.readonly',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: config.GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: config.GOOGLE_OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
      state: signedState,
    });

    const googleConsentUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return res.redirect(googleConsentUrl);
  } catch (error) {
    console.error('[Google OAuth Connect] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

const getFrontendUrl = (): string => {
  const primary = (config.CORS_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
  return primary.replace(/\/+$/, '');
};

// ── GET /api/integrations/google/callback ───────────────────────────────────
router.get(['/integrations/google/callback', '/callback'], async (req: Request, res: Response) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      console.warn('[Google OAuth Callback] Consent denied or error:', oauthError);
      return res.redirect(`${getFrontendUrl()}/projects?google_error=${encodeURIComponent(String(oauthError))}`);
    }

    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state in OAuth callback' });
    }

    const verified = verifyOAuthState(String(state));
    if (!verified) {
      console.warn('[Google OAuth Callback] Invalid or tampered OAuth state parameter:', state);
      return res.redirect(`${getFrontendUrl()}/projects?google_error=invalid_state`);
    }

    const { projectId } = verified;
    const project = await Project.findOne({ _id: projectId, deletedAt: null });
    if (!project) {
      return res.redirect(`${getFrontendUrl()}/projects?google_error=project_not_found`);
    }

    // Exchange code for tokens
    const tokenParams = new URLSearchParams({
      code: String(code),
      client_id: config.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: config.GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    let tokenData: { access_token?: string; refresh_token?: string; scope?: string };
    try {
      const tokenResponse = await axios.post<{
        access_token?: string;
        refresh_token?: string;
        scope?: string;
      }>('https://oauth2.googleapis.com/token', tokenParams.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      });
      tokenData = tokenResponse.data;
    } catch (tokenErr) {
      console.error('[Google OAuth Callback] Token exchange failed:', tokenErr instanceof Error ? tokenErr.message : tokenErr);
      return res.redirect(`${getFrontendUrl()}/projects/${projectId}?google_error=token_exchange_failed`);
    }

    const refreshToken = tokenData.refresh_token;
    if (!refreshToken) {
      console.warn('[Google OAuth Callback] Refresh token not returned by Google');
      // If user re-granted without consent prompt, refresh_token may be missing.
    }

    const encryptedRefreshToken = refreshToken ? encryptToken(refreshToken) : project.googleIntegration?.encryptedRefreshToken || null;
    const scopeList = tokenData.scope ? tokenData.scope.split(' ') : [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/webmasters.readonly',
    ];

    project.googleIntegration = {
      gaPropertyId: project.googleIntegration?.gaPropertyId || null,
      gscSiteUrl: project.googleIntegration?.gscSiteUrl || null,
      encryptedRefreshToken,
      scopes: scopeList,
      connectedAt: new Date(),
      lastSyncedAt: project.googleIntegration?.lastSyncedAt || null,
    };

    await project.save();

    return res.redirect(`${getFrontendUrl()}/projects/${projectId}?google_connected=true`);
  } catch (error) {
    console.error('[Google OAuth Callback] Exception:', error);
    return res.redirect(`${getFrontendUrl()}/projects?google_error=server_error`);
  }
});

// ── GET /api/projects/:id/integrations/google/status ───────────────────────
router.get('/projects/:id/integrations/google/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const gi = project.googleIntegration;
    const isConnected = Boolean(gi && gi.encryptedRefreshToken);

    const status: GoogleIntegrationStatus = {
      connected: isConnected,
      gaPropertyId: gi?.gaPropertyId || undefined,
      gscSiteUrl: gi?.gscSiteUrl || undefined,
      connectedAt: gi?.connectedAt ? gi.connectedAt.toISOString() : undefined,
      lastSyncedAt: gi?.lastSyncedAt ? gi.lastSyncedAt.toISOString() : undefined,
      scopes: gi?.scopes && gi.scopes.length > 0 ? gi.scopes : undefined,
    };

    return res.json(status);
  } catch (error) {
    console.error('[Google Status] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/projects/:id/integrations/google ────────────────────────────
router.patch('/projects/:id/integrations/google', paidApiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.googleIntegration || !project.googleIntegration.encryptedRefreshToken) {
      return res.status(400).json({ error: 'Google integration is not connected for this project' });
    }

    const schema = z.object({
      gaPropertyId: z.string().nullable().optional(),
      gscSiteUrl: z.string().nullable().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.flatten().fieldErrors });
    }

    const { gaPropertyId, gscSiteUrl } = validation.data;

    if (gaPropertyId !== undefined) {
      project.googleIntegration.gaPropertyId = gaPropertyId;
    }
    if (gscSiteUrl !== undefined) {
      project.googleIntegration.gscSiteUrl = gscSiteUrl;
    }

    await project.save();

    const gi = project.googleIntegration;
    const status: GoogleIntegrationStatus = {
      connected: true,
      gaPropertyId: gi.gaPropertyId || undefined,
      gscSiteUrl: gi.gscSiteUrl || undefined,
      connectedAt: gi.connectedAt ? gi.connectedAt.toISOString() : undefined,
      lastSyncedAt: gi.lastSyncedAt ? gi.lastSyncedAt.toISOString() : undefined,
      scopes: gi.scopes || undefined,
    };

    return res.json(status);
  } catch (error) {
    console.error('[Google Patch] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/projects/:id/integrations/google/disconnect ──────────────────
router.post('/projects/:id/integrations/google/disconnect', paidApiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.googleIntegration?.encryptedRefreshToken) {
      try {
        const refreshToken = decryptToken(project.googleIntegration.encryptedRefreshToken);
        await axios.post(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, null, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
        });
      } catch (err) {
        console.warn('[Google Disconnect] Revoke token failed (best effort):', err instanceof Error ? err.message : err);
      }
    }

    project.googleIntegration = null;
    await project.save();

    return res.json({ message: 'Google integration disconnected successfully' });
  } catch (error) {
    console.error('[Google Disconnect] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/projects/:id/integrations/google/available-properties ──────────
router.get('/projects/:id/integrations/google/available-properties', paidApiRateLimiter, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid project ID format' });
    }

    const project = await Project.findOne({ _id: id, deletedAt: null });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.googleIntegration?.encryptedRefreshToken) {
      return res.status(400).json({ error: 'Google integration is not connected for this project' });
    }

    let accessToken: string;
    try {
      accessToken = await getFreshAccessToken(project);
    } catch (tokenErr) {
      console.warn('[Available Properties] Token refresh error:', tokenErr);
      return res.status(400).json({
        error: 'Google authentication failed or expired. Please reconnect your Google account.',
        gaProperties: [],
        gscSites: [],
      });
    }

    let gaError: string | null = null;
    let gscError: string | null = null;

    // Fetch GA4 Properties from Admin API
    let gaProperties: Array<{ id: string; name: string }> = [];
    try {
      const gaRes = await axios.get<{
        accountSummaries?: Array<{
          propertySummaries?: Array<{ property: string; displayName: string }>;
        }>;
      }>('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000,
      });

      if (gaRes.data?.accountSummaries) {
        for (const acc of gaRes.data.accountSummaries) {
          if (acc.propertySummaries) {
            for (const prop of acc.propertySummaries) {
              gaProperties.push({
                id: prop.property.replace('properties/', ''),
                name: prop.displayName,
              });
            }
          }
        }
      }
    } catch (e: any) {
      gaError = e?.response?.data?.error?.message || e.message || 'Failed to fetch GA4 properties';
      console.warn('[Available Properties] GA4 fetch error:', gaError);
    }

    // Fetch Search Console sites
    let gscSites: Array<{ siteUrl: string; permissionLevel: string }> = [];
    try {
      const gscRes = await axios.get<{
        siteEntry?: Array<{ siteUrl: string; permissionLevel: string }>;
      }>('https://www.googleapis.com/webmasters/v3/sites', {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000,
      });

      if (gscRes.data?.siteEntry) {
        gscSites = gscRes.data.siteEntry.map((s) => ({
          siteUrl: s.siteUrl,
          permissionLevel: s.permissionLevel,
        }));
      }
    } catch (e: any) {
      gscError = e?.response?.data?.error?.message || e.message || 'Failed to fetch GSC sites';
      console.warn('[Available Properties] GSC fetch error:', gscError);
    }

    return res.json({
      gaProperties,
      gscSites,
      gaError,
      gscError,
    });
  } catch (error) {
    console.error('[Available Properties] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
