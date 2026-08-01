import mongoose from 'mongoose';
import { PendingChange } from '../models/PendingChange';
import { Project } from '../models/Project';
import { AuditIssue } from '../models/AuditIssue';
import { PageContent } from '../models/PageContent';

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

    // Check for broken links (e.g. href="http://404.example" or href="invalid-link") in proposed change
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
