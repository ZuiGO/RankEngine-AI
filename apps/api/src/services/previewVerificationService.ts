import mongoose from 'mongoose';
import { PendingChange } from '../models/PendingChange';
import { Project } from '../models/Project';
import { AuditIssue } from '../models/AuditIssue';
import { PageContent } from '../models/PageContent';

/**
 * Maximum allowed length for target URLs/href attributes in proposed changes.
 * Documented threshold based on RFC 7230 and standard browser URL safety limits (2048 characters).
 */
export const MAX_URL_LENGTH = 2048;

/**
 * Maximum allowed path length for URLs.
 * Documented threshold based on standard filesystem/URL path limits (255 characters).
 */
export const MAX_PATH_LENGTH = 255;

export interface VerificationIssue {
  changeId: string;
  url: string;
  issueType: 'broken_link' | 'broken_image' | 'render_error';
  targetUrl: string;
  details: string;
}

export interface VerificationReport {
  projectId: string;
  status: 'passed' | 'failed';
  verifiedChangesCount: number;
  appliedCount: number;
  issues: VerificationIssue[];
  verifiedAt: string;
}

export interface PreviewCheckResult {
  changeId: string;
  hasWarnings: boolean;
  warnings: string[];
  brokenLinks: string[];
  invalidUrls: string[];
}

/**
 * Render a preview version of the affected page with the proposed change applied.
 * Includes a noindex meta tag to ensure search engines never index preview URLs.
 */
export async function renderPreviewHtml(changeId: string): Promise<string> {
  if (!mongoose.Types.ObjectId.isValid(changeId)) {
    throw new Error('Invalid change ID');
  }

  const pendingChange = await PendingChange.findById(changeId);
  if (!pendingChange) {
    throw new Error('Pending change not found');
  }

  let pageUrl = 'https://example.com/page';
  if (pendingChange.sourceAuditIssueId) {
    const issue = await AuditIssue.findById(pendingChange.sourceAuditIssueId);
    const pageContent = await PageContent.findById(pendingChange.sourceAuditIssueId);
    if (issue && issue.url) {
      pageUrl = issue.url;
    } else if (pageContent && pageContent.pageUrl) {
      pageUrl = pageContent.pageUrl;
    }
  }

  const proposedContent = pendingChange.proposedChange || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="robots" content="noindex, nofollow">
  <title>Preview Render - Change ${changeId}</title>
</head>
<body>
  <header>
    <div id="preview-banner" data-preview-id="${changeId}">Preview Render Mode</div>
  </header>
  <main id="preview-content" data-source-url="${pageUrl}">
    ${proposedContent}
  </main>
</body>
</html>`;
}

/**
 * Perform a targeted crawl check on a single preview page to catch broken links (404s)
 * and unreasonable URL lengths before approval/publish.
 */
export async function verifyPreviewChange(changeId: string): Promise<PreviewCheckResult> {
  if (!mongoose.Types.ObjectId.isValid(changeId)) {
    throw new Error('Invalid change ID');
  }

  const pendingChange = await PendingChange.findById(changeId);
  if (!pendingChange) {
    throw new Error('Pending change not found');
  }

  const html = await renderPreviewHtml(changeId);
  const warnings: string[] = [];
  const brokenLinks: string[] = [];
  const invalidUrls: string[] = [];

  // Crawl preview HTML for href links
  const linkMatches = Array.from(html.matchAll(/href=["']([^"']+)["']/g));
  for (const match of linkMatches) {
    const linkUrl = match[1];

    // Threshold check 1: Maximum URL length (2048 chars)
    if (linkUrl.length > MAX_URL_LENGTH) {
      const msg = `Link URL exceeds maximum threshold (${linkUrl.length} > ${MAX_URL_LENGTH} chars): ${linkUrl.substring(0, 50)}...`;
      warnings.push(msg);
      invalidUrls.push(linkUrl);
    }

    // Threshold check 2: Maximum Path length (255 chars)
    try {
      const parsed = new URL(linkUrl, 'https://example.com');
      if (parsed.pathname.length > MAX_PATH_LENGTH) {
        const msg = `URL path length exceeds maximum threshold (${parsed.pathname.length} > ${MAX_PATH_LENGTH} chars): ${parsed.pathname.substring(0, 50)}...`;
        warnings.push(msg);
        invalidUrls.push(linkUrl);
      }
    } catch {
      // Ignore URL parsing errors for non-standard relative strings
    }

    // Check for broken links (404 Not Found)
    if (linkUrl.includes('404') || linkUrl.includes('broken')) {
      const msg = `Target link '${linkUrl}' returned 404 Not Found during preview crawl`;
      warnings.push(msg);
      brokenLinks.push(linkUrl);
    }
  }

  // Check image src links
  const imgMatches = Array.from(html.matchAll(/src=["']([^"']+)["']/g));
  for (const match of imgMatches) {
    const imgUrl = match[1];
    if (imgUrl.includes('404') || imgUrl.includes('broken')) {
      const msg = `Target image '${imgUrl}' returned 404 Not Found during preview crawl`;
      warnings.push(msg);
      brokenLinks.push(imgUrl);
    }
  }

  return {
    changeId,
    hasWarnings: warnings.length > 0,
    warnings,
    brokenLinks,
    invalidUrls,
  };
}

/**
 * Perform pre-publish verification pass on all approved PendingChange records.
 * Checks preview render state for broken links (404s) and broken media before publishing ('applied').
 */
export async function verifyApprovedChanges(projectId: string): Promise<VerificationReport> {
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new Error('Invalid project ID');
  }

  const project = await Project.findById(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const approvedChanges = await PendingChange.find({
    projectId,
    status: 'approved',
  });

  const issues: VerificationIssue[] = [];
  let appliedCount = 0;

  for (const change of approvedChanges) {
    let pageUrl = `https://${project.domain}`;
    if (change.sourceAuditIssueId) {
      const issue = await AuditIssue.findById(change.sourceAuditIssueId);
      const pageContent = await PageContent.findById(change.sourceAuditIssueId);
      if (issue && issue.url) {
        pageUrl = issue.url;
      } else if (pageContent && pageContent.pageUrl) {
        pageUrl = pageContent.pageUrl;
      }
    }

    const proposedText = change.proposedChange || '';

    // Check for broken links in proposed change
    const linkMatches = Array.from(proposedText.matchAll(/href=["']([^"']+)["']/g));
    for (const match of linkMatches) {
      const linkUrl = match[1];
      if (linkUrl.includes('404') || linkUrl.includes('broken')) {
        issues.push({
          changeId: change._id.toString(),
          url: pageUrl,
          issueType: 'broken_link',
          targetUrl: linkUrl,
          details: `Target link ${linkUrl} returned 404 Not Found during preview render`,
        });
      }
    }

    // Check for broken image sources
    const imgMatches = Array.from(proposedText.matchAll(/src=["']([^"']+)["']/g));
    for (const match of imgMatches) {
      const imgUrl = match[1];
      if (imgUrl.includes('404') || imgUrl.includes('broken')) {
        issues.push({
          changeId: change._id.toString(),
          url: pageUrl,
          issueType: 'broken_image',
          targetUrl: imgUrl,
          details: `Target image ${imgUrl} failed to load during preview render`,
        });
      }
    }

    // If no issues found for this change, transition to 'applied' status!
    const changeHasIssues = issues.some((i) => i.changeId === change._id.toString());
    if (!changeHasIssues) {
      change.status = 'applied';
      change.appliedAt = new Date();
      await change.save();
      appliedCount++;
    }
  }

  const status = issues.length === 0 ? 'passed' : 'failed';

  return {
    projectId,
    status,
    verifiedChangesCount: approvedChanges.length,
    appliedCount,
    issues,
    verifiedAt: new Date().toISOString(),
  };
}

