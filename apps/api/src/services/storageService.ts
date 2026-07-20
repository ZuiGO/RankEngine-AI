import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import config from '../config';

const STORAGE_PATH = path.resolve(config.STORAGE_PATH);

/**
 * Ensure the storage directory exists on disk, creating it recursively if needed.
 */
function ensureStorageDir(subDir?: string): string {
  const dir = subDir ? path.join(STORAGE_PATH, subDir) : STORAGE_PATH;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Save a buffer to the local storage directory and return the absolute file path.
 */
export function saveFile(buffer: Buffer, filename: string): string {
  const dir = ensureStorageDir();
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Get a readable stream for a stored file at an absolute path.
 */
export function getFileStream(filePath: string): fs.ReadStream {
  return fs.createReadStream(filePath);
}

/**
 * Delete a file from storage.
 */
export function deleteFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Get file size in bytes.
 */
export function getFileSize(filePath: string): number {
  const stat = fs.statSync(filePath);
  return stat.size;
}

/**
 * Generate a cryptographically random download token with a TTL.
 */
export function generateDownloadToken(): { token: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + config.DOWNLOAD_TOKEN_TTL_MS);
  return { token, expiresAt };
}

/**
 * Convert a stored absolute file path to a publicly accessible URL path.
 * The returned path should be mounted by the caller (e.g. via express.static).
 */
export function getFileUrl(filePath: string): string {
  const filename = path.basename(filePath);
  return `/api/files/${filename}`;
}

/**
 * Generate a unique filename for an uploaded file, preserving its extension.
 */
export function generateFilename(originalName: string): string {
  const ext = path.extname(originalName) || '.png';
  return `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
}
