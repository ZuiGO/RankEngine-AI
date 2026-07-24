import crypto from 'crypto';
import axios from 'axios';
import config from '../config';
import { IProject } from '../models/Project';

// Derive a 32-byte key for AES-256-GCM from GOOGLE_TOKEN_ENCRYPTION_KEY or fallback
function getEncryptionKey(): Buffer {
  const secret = config.GOOGLE_TOKEN_ENCRYPTION_KEY || 'default-rankengine-google-encryption-key-fallback';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a raw token using AES-256-GCM.
 * Output format: "iv:authTag:encryptedData" (hex encoded)
 */
export function encryptToken(raw: string): string {
  if (!raw) {
    throw new Error('Cannot encrypt empty token');
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(raw, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt an AES-256-GCM encrypted token string.
 * Input format expected: "iv:authTag:encryptedData"
 */
export function decryptToken(encryptedString: string): string {
  if (!encryptedString) {
    throw new Error('Cannot decrypt empty token');
  }
  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }

  const [ivHex, authTagHex, cipherTextHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherTextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Exchange the stored encrypted refresh token for a fresh short-lived access token via Google OAuth token endpoint.
 */
export async function getFreshAccessToken(project: IProject): Promise<string> {
  const encryptedToken = project.googleIntegration?.encryptedRefreshToken;
  if (!encryptedToken) {
    throw new Error('Google integration token missing for project');
  }

  const refreshToken = decryptToken(encryptedToken);

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.GOOGLE_OAUTH_CLIENT_ID || 'mock-client-id',
    client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET || 'mock-client-secret',
    refresh_token: refreshToken,
  });

  const response = await axios.post<{ access_token?: string }>(
    'https://oauth2.googleapis.com/token',
    params.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10000,
    }
  );

  if (!response.data?.access_token) {
    throw new Error('Google token response did not contain access_token');
  }

  return response.data.access_token;
}
