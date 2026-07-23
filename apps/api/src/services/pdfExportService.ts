import puppeteer from 'puppeteer';
import {
  ContentPerformanceReport,
  BeforeAfterComparisonReport,
} from '@rankengine/shared-types';

export type ReportType = 'audit' | 'content-performance' | 'before-after-comparison';

// ── Types ──────────────────────────────────────────────────────────────

export interface ReportSection {
  title: string;
  type: 'score_gauge' | 'table' | 'chart' | 'checklist' | 'text';
  data: Record<string, unknown>;
}

export interface WhiteLabelConfig {
  agencyName: string;
  agencyLogoUrl?: string;
  primaryColor?: string;
  reportFooterText?: string;
}

export interface ReportPayload {
  projectId: string;
  projectName: string;
  domain: string;
  generatedAt: string;
  sections: ReportSection[];
  whiteLabel?: WhiteLabelConfig;
}

// ── Helpers ────────────────────────────────────────────────────────────

export function buildReportPayload(
  projectId: string,
  projectName: string,
  domain: string,
  sections: ReportSection[],
  whiteLabel?: WhiteLabelConfig
): ReportPayload {
  return {
    projectId,
    projectName,
    domain,
    generatedAt: new Date().toISOString(),
    sections,
    whiteLabel,
  };
}

// ── Content Performance HTML Template Builder ─────────────────────────

export function buildContentPerformanceHtml(
  report: ContentPerformanceReport,
  whiteLabel?: WhiteLabelConfig
): string {
  const brand = whiteLabel;
  const primaryColor = brand?.primaryColor ?? '#4f46e5';
  const headerBorder = `style="border-top: 4px solid ${primaryColor};"`;
  const headerBg = brand?.primaryColor ?? '#1e293b';

  const logoHtml = brand?.agencyLogoUrl
    ? `<img src="${brand.agencyLogoUrl}" alt="${escapeHtml(brand.agencyName)}" style="height:32px;" />`
    : `<span style="font-size:18px;font-weight:700;color:#f8fafc;">${escapeHtml(brand?.agencyName || 'Content Performance Report')}</span>`;

  let overallColor = '#dc2626';
  if (report.overallScore >= 80) overallColor = '#16a34a';
  else if (report.overallScore >= 50) overallColor = '#d97706';

  const pagesHtml = report.pages.map((p) => {
    let scoreColor = '#dc2626';
    if (p.seoScore >= 80) scoreColor = '#16a34a';
    else if (p.seoScore >= 50) scoreColor = '#d97706';

    const issuesList = p.issues.length > 0
      ? p.issues.map((iss) => {
          let badgeBg = '#eff6ff';
          let badgeColor = '#2563eb';
          if (iss.severity === 'critical') {
            badgeBg = '#fef2f2';
            badgeColor = '#dc2626';
          } else if (iss.severity === 'warning') {
            badgeBg = '#fffbeb';
            badgeColor = '#d97706';
          }
          return `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;">
            <span style="background:${badgeBg};color:${badgeColor};font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;text-transform:uppercase;">${escapeHtml(iss.severity)}</span>
            <span style="color:#1e293b;">[${escapeHtml(iss.category)}] ${escapeHtml(iss.message)}</span>
          </div>`;
        }).join('')
      : '<p style="font-size:12px;color:#16a34a;margin-top:4px;">No issues identified</p>';

    let analyticsHtml = '';
    if ((report.gaConnected && p.analytics) || (report.gscConnected && p.searchConsole)) {
      analyticsHtml = `<table style="width:100%;margin-top:8px;border-collapse:collapse;font-size:11px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;">
        <tr style="background:#f1f5f9;color:#475569;font-weight:600;">
          <th style="padding:4px 8px;text-align:left;">Sessions</th>
          <th style="padding:4px 8px;text-align:left;">Engagement</th>
          <th style="padding:4px 8px;text-align:left;">Clicks</th>
          <th style="padding:4px 8px;text-align:left;">Impressions</th>
          <th style="padding:4px 8px;text-align:left;">CTR</th>
          <th style="padding:4px 8px;text-align:left;">Avg Pos</th>
        </tr>
        <tr>
          <td style="padding:4px 8px;">${p.analytics?.sessions ?? 'N/A'}</td>
          <td style="padding:4px 8px;">${p.analytics ? `${(p.analytics.engagementRate * 100).toFixed(1)}%` : 'N/A'}</td>
          <td style="padding:4px 8px;">${p.searchConsole?.clicks ?? 'N/A'}</td>
          <td style="padding:4px 8px;">${p.searchConsole?.impressions ?? 'N/A'}</td>
          <td style="padding:4px 8px;">${p.searchConsole ? `${(p.searchConsole.ctr * 100).toFixed(1)}%` : 'N/A'}</td>
          <td style="padding:4px 8px;">${p.searchConsole ? p.searchConsole.avgPosition.toFixed(1) : 'N/A'}</td>
        </tr>
      </table>`;
    }

    return `<div style="margin-bottom:24px;padding:16px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div>
          <h4 style="font-size:14px;font-weight:700;color:#0f172a;">${escapeHtml(p.title || p.path)}</h4>
          <p style="font-size:11px;color:#64748b;">${escapeHtml(p.url)}</p>
        </div>
        <span style="font-size:18px;font-weight:800;color:${scoreColor};background:${scoreColor}15;padding:4px 12px;border-radius:16px;">${p.seoScore}</span>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">
        <tr style="background:#f8fafc;color:#475569;">
          <th style="padding:4px 6px;text-align:left;">Title Len</th>
          <th style="padding:4px 6px;text-align:left;">Desc Len</th>
          <th style="padding:4px 6px;text-align:left;">H1s</th>
          <th style="padding:4px 6px;text-align:left;">Words</th>
          <th style="padding:4px 6px;text-align:left;">Readability</th>
          <th style="padding:4px 6px;text-align:left;">Missing Alt</th>
          <th style="padding:4px 6px;text-align:left;">Links</th>
          <th style="padding:4px 6px;text-align:left;">Schema</th>
          <th style="padding:4px 6px;text-align:left;">Indexable</th>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="padding:4px 6px;">${p.titleLength}</td>
          <td style="padding:4px 6px;">${p.metaDescriptionLength}</td>
          <td style="padding:4px 6px;">${p.h1Count}</td>
          <td style="padding:4px 6px;">${p.wordCount}</td>
          <td style="padding:4px 6px;">${p.readabilityScore}</td>
          <td style="padding:4px 6px;">${p.imagesMissingAlt}</td>
          <td style="padding:4px 6px;">${p.internalLinkCount}</td>
          <td style="padding:4px 6px;">${p.hasStructuredData ? 'Yes' : 'No'}</td>
          <td style="padding:4px 6px;">${p.isIndexable ? 'Yes' : 'No'}</td>
        </tr>
      </table>

      ${analyticsHtml}
      <div style="margin-top:8px;">${issuesList}</div>
    </div>`;
  }).join('\n');

  const topCategoriesHtml = report.summary.topIssueCategories
    .map((c) => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid #f1f5f9;">
      <span style="color:#334155;font-weight:600;text-transform:capitalize;">${escapeHtml(c.category)}</span>
      <span style="color:#64748b;font-weight:700;">${c.count}</span>
    </div>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Content Performance Report — ${escapeHtml(report.siteUrl)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f1f5f9; padding: 40px; }
  .report { max-width: 860px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); overflow: hidden; }
  .header { padding: 28px 36px; display: flex; justify-content: space-between; align-items: center; }
  .body { padding: 36px; }
  .section { margin-bottom: 28px; padding: 20px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
  .section-title { font-size: 15px; font-weight: 700; color: ${primaryColor}; margin-bottom: 12px; }
  .footer { text-align: center; padding: 24px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
</style>
</head>
<body>
<div class="report" ${headerBorder}>
  <div class="header" style="background:${headerBg};">
    ${logoHtml}
    <div style="text-align:right;">
      <p style="font-size:14px;font-weight:600;color:#f8fafc;">Content Performance Report</p>
      <p style="font-size:12px;color:#cbd5e1;">${escapeHtml(report.siteUrl)}</p>
    </div>
  </div>
  <div class="body">
    <p style="font-size:11px;color:#94a3b8;margin-bottom:24px;">Generated ${new Date(report.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

    <!-- Cover Gauge & Overall Score -->
    <div class="section" style="text-align:center;">
      <div style="font-size:13px;font-weight:600;color:#64748b;margin-bottom:8px;">OVERALL CONTENT SEO SCORE</div>
      <div style="font-size:64px;font-weight:800;color:${overallColor};line-height:1;">${report.overallScore}</div>
      <div style="font-size:12px;color:#64748b;margin-top:6px;">Evaluated across ${report.pageCount} crawled pages</div>
    </div>

    <!-- Summary -->
    <div class="section">
      <div class="section-title">Report Summary</div>
      <div style="display:flex;gap:12px;margin-bottom:16px;">
        <div style="flex:1;background:#ffffff;border:1px solid #e2e8f0;padding:12px;border-radius:6px;text-align:center;">
          <div style="font-size:24px;font-weight:700;color:#1e293b;">${report.summary.avgScore}</div>
          <div style="font-size:11px;color:#64748b;">Average Score</div>
        </div>
        <div style="flex:1;background:#ffffff;border:1px solid #e2e8f0;padding:12px;border-radius:6px;text-align:center;">
          <div style="font-size:24px;font-weight:700;color:#dc2626;">${report.summary.criticalIssueCount}</div>
          <div style="font-size:11px;color:#64748b;">Critical Issues</div>
        </div>
        <div style="flex:1;background:#ffffff;border:1px solid #e2e8f0;padding:12px;border-radius:6px;text-align:center;">
          <div style="font-size:24px;font-weight:700;color:#d97706;">${report.summary.warningIssueCount}</div>
          <div style="font-size:11px;color:#64748b;">Warnings</div>
        </div>
      </div>
      <div style="font-size:13px;font-weight:600;color:#0f172a;margin-bottom:6px;">Top Issue Categories</div>
      ${topCategoriesHtml || '<p style="font-size:12px;color:#64748b;">No categories recorded</p>'}
    </div>

    <!-- Per-Page Breakdown -->
    <div style="margin-top:28px;">
      <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:16px;">Per-Page Analysis</h3>
      ${pagesHtml}
    </div>
  </div>
  <div class="footer">${brand?.reportFooterText ? escapeHtml(brand.reportFooterText) : 'RankEngine AI — Content Performance Report Export'}</div>
</div>
</body>
</html>`;
}

// ── Comparison HTML Template Builder ──────────────────────────────────

export function buildComparisonHtml(
  report: BeforeAfterComparisonReport,
  whiteLabel?: WhiteLabelConfig
): string {
  const brand = whiteLabel;
  const primaryColor = brand?.primaryColor ?? '#4f46e5';
  const headerBorder = `style="border-top: 4px solid ${primaryColor};"`;
  const headerBg = brand?.primaryColor ?? '#1e293b';

  const logoHtml = brand?.agencyLogoUrl
    ? `<img src="${brand.agencyLogoUrl}" alt="${escapeHtml(brand.agencyName)}" style="height:32px;" />`
    : `<span style="font-size:18px;font-weight:700;color:#f8fafc;">${escapeHtml(brand?.agencyName || 'Before / After Comparison Report')}</span>`;

  const delta = report.overallScoreAfter - report.overallScoreBefore;
  const deltaSign = delta >= 0 ? `+${delta}` : `${delta}`;
  const deltaBg = delta >= 0 ? '#f0fdf4' : '#fef2f2';
  const deltaTextColor = delta >= 0 ? '#16a34a' : '#dc2626';

  const matchedPagesHtml = report.pages
    .filter((p) => p.status === 'matched')
    .map((p) => {
      const changesRows = p.changes
        .map((c) => {
          let rowBg = '#f8fafc';
          let textColor = '#475569';
          if (c.impact === 'improvement') {
            rowBg = '#f0fdf4';
            textColor = '#16a34a';
          } else if (c.impact === 'regression') {
            rowBg = '#fef2f2';
            textColor = '#dc2626';
          }
          return `<tr style="background:${rowBg};border-bottom:1px solid #e2e8f0;">
            <td style="padding:6px 8px;font-weight:600;color:#1e293b;">${escapeHtml(c.field)}</td>
            <td style="padding:6px 8px;color:#64748b;">${escapeHtml(String(c.before))}</td>
            <td style="padding:6px 8px;font-weight:600;color:${textColor};">${escapeHtml(String(c.after))}</td>
            <td style="padding:6px 8px;font-weight:700;color:${textColor};text-transform:capitalize;">${c.impact}</td>
          </tr>`;
        })
        .join('');

      return `<div style="margin-bottom:20px;padding:16px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div>
            <h4 style="font-size:14px;font-weight:700;color:#0f172a;">${escapeHtml(p.path)}</h4>
            <p style="font-size:11px;color:#64748b;">${escapeHtml(p.oldUrl || '')} &rarr; ${escapeHtml(p.newUrl || '')}</p>
          </div>
          <div style="font-size:14px;font-weight:700;">
            ${p.before?.seoScore ?? 0} &rarr; <span style="color:${(p.scoreDelta || 0) >= 0 ? '#16a34a' : '#dc2626'};">${p.after?.seoScore ?? 0} (${(p.scoreDelta || 0) >= 0 ? `+${p.scoreDelta}` : p.scoreDelta})</span>
          </div>
        </div>

        ${changesRows
          ? `<table style="width:100%;border-collapse:collapse;font-size:11px;">
              <thead>
                <tr style="background:#f1f5f9;color:#475569;text-align:left;">
                  <th style="padding:6px 8px;">Field</th>
                  <th style="padding:6px 8px;">Before</th>
                  <th style="padding:6px 8px;">After</th>
                  <th style="padding:6px 8px;">Impact</th>
                </tr>
              </thead>
              <tbody>${changesRows}</tbody>
            </table>`
          : '<p style="font-size:11px;color:#64748b;">No field changes detected</p>'
        }
      </div>`;
    })
    .join('\n');

  const addedPages = report.pages.filter((p) => p.status === 'added');
  const removedPages = report.pages.filter((p) => p.status === 'removed');

  const addedHtml = addedPages.length > 0
    ? `<div style="margin-bottom:20px;">
        <h4 style="font-size:14px;font-weight:700;color:#16a34a;margin-bottom:8px;">Added Pages (${addedPages.length})</h4>
        <ul style="font-size:12px;color:#334155;padding-left:20px;">
          ${addedPages.map((ap) => `<li><strong>${escapeHtml(ap.path)}</strong> (${escapeHtml(ap.newUrl || '')}) — SEO Score: ${ap.after?.seoScore ?? 'N/A'}</li>`).join('')}
        </ul>
      </div>`
    : '';

  const removedHtml = removedPages.length > 0
    ? `<div style="margin-bottom:20px;">
        <h4 style="font-size:14px;font-weight:700;color:#dc2626;margin-bottom:8px;">Removed Pages (${removedPages.length})</h4>
        <ul style="font-size:12px;color:#334155;padding-left:20px;">
          ${removedPages.map((rp) => `<li><strong>${escapeHtml(rp.path)}</strong> (${escapeHtml(rp.oldUrl || '')}) — Former Score: ${rp.before?.seoScore ?? 'N/A'}</li>`).join('')}
        </ul>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Before/After Comparison Report — ${escapeHtml(report.oldSiteUrl)} vs ${escapeHtml(report.newSiteUrl)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f1f5f9; padding: 40px; }
  .report { max-width: 860px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); overflow: hidden; }
  .header { padding: 28px 36px; display: flex; justify-content: space-between; align-items: center; }
  .body { padding: 36px; }
  .section { margin-bottom: 28px; padding: 20px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
  .section-title { font-size: 15px; font-weight: 700; color: ${primaryColor}; margin-bottom: 12px; }
  .footer { text-align: center; padding: 24px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
</style>
</head>
<body>
<div class="report" ${headerBorder}>
  <div class="header" style="background:${headerBg};">
    ${logoHtml}
    <div style="text-align:right;">
      <p style="font-size:14px;font-weight:600;color:#f8fafc;">Before / After Comparison Report</p>
      <p style="font-size:11px;color:#cbd5e1;">${escapeHtml(report.oldSiteUrl)} &rarr; ${escapeHtml(report.newSiteUrl)}</p>
    </div>
  </div>
  <div class="body">
    <p style="font-size:11px;color:#94a3b8;margin-bottom:24px;">Generated ${new Date(report.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

    <!-- Cover Overall Score Delta -->
    <div class="section" style="text-align:center;">
      <div style="font-size:13px;font-weight:600;color:#64748b;margin-bottom:8px;">OVERALL SEO SCORE CHANGE</div>
      <div style="font-size:48px;font-weight:800;color:#0f172a;line-height:1;">
        ${report.overallScoreBefore} &rarr; ${report.overallScoreAfter}
        <span style="font-size:24px;font-weight:700;background:${deltaBg};color:${deltaTextColor};padding:4px 12px;border-radius:12px;vertical-align:middle;margin-left:8px;">(${deltaSign})</span>
      </div>
    </div>

    <!-- Summary Counts -->
    <div class="section">
      <div class="section-title">Comparison Summary</div>
      <div style="display:flex;gap:10px;">
        <div style="flex:1;background:#ffffff;border:1px solid #e2e8f0;padding:10px;border-radius:6px;text-align:center;">
          <div style="font-size:20px;font-weight:700;color:#16a34a;">${report.pagesImproved}</div>
          <div style="font-size:10px;color:#64748b;">Improved</div>
        </div>
        <div style="flex:1;background:#ffffff;border:1px solid #e2e8f0;padding:10px;border-radius:6px;text-align:center;">
          <div style="font-size:20px;font-weight:700;color:#dc2626;">${report.pagesRegressed}</div>
          <div style="font-size:10px;color:#64748b;">Regressed</div>
        </div>
        <div style="flex:1;background:#ffffff;border:1px solid #e2e8f0;padding:10px;border-radius:6px;text-align:center;">
          <div style="font-size:20px;font-weight:700;color:#64748b;">${report.pagesUnchanged}</div>
          <div style="font-size:10px;color:#64748b;">Unchanged</div>
        </div>
        <div style="flex:1;background:#ffffff;border:1px solid #e2e8f0;padding:10px;border-radius:6px;text-align:center;">
          <div style="font-size:20px;font-weight:700;color:#2563eb;">${report.pagesAdded}</div>
          <div style="font-size:10px;color:#64748b;">Added</div>
        </div>
        <div style="flex:1;background:#ffffff;border:1px solid #e2e8f0;padding:10px;border-radius:6px;text-align:center;">
          <div style="font-size:20px;font-weight:700;color:#d97706;">${report.pagesRemoved}</div>
          <div style="font-size:10px;color:#64748b;">Removed</div>
        </div>
      </div>
    </div>

    <!-- Disclaimer Note -->
    <div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:12px 16px;font-size:12px;color:#1e3a8a;border-radius:0 6px 6px 0;margin-bottom:28px;">
      <strong>Note:</strong> ${escapeHtml(report.note)}
    </div>

    <!-- Matched Pages Comparison -->
    <div style="margin-top:28px;">
      <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:16px;">Matched Page Comparison</h3>
      ${matchedPagesHtml || '<p style="font-size:12px;color:#64748b;">No matched pages found.</p>'}
    </div>

    ${addedHtml}
    ${removedHtml}
  </div>
  <div class="footer">${brand?.reportFooterText ? escapeHtml(brand.reportFooterText) : 'RankEngine AI — Before/After Comparison Report Export'}</div>
</div>
</body>
</html>`;
}

// ── HTML Template ──────────────────────────────────────────────────────

export function generateReportHtml(payload: ReportPayload): string {
  const brand = payload.whiteLabel;
  const primaryColor = brand?.primaryColor ?? '#4f46e5';
  const headerBorder = `style="border-top: 4px solid ${primaryColor};"`;
  const headerBg = brand?.primaryColor ?? '#1e293b';

  const logoHtml = brand?.agencyLogoUrl
    ? `<img src="${brand.agencyLogoUrl}" alt="${brand.agencyName}" style="height:32px;" />`
    : `<span style="font-size:18px;font-weight:700;color:#f8fafc;">${brand?.agencyName || payload.projectName}</span>`;

  const sectionsHtml = payload.sections.map((s) => renderSection(s, primaryColor)).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(payload.projectName)} — SEO Audit Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f1f5f9; padding: 40px; }
  .report { max-width: 860px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); overflow: hidden; }
  .header { padding: 28px 36px; display: flex; justify-content: space-between; align-items: center; }
  .header-right { text-align: right; }
  .header-right .project-name { font-size: 14px; font-weight: 600; color: #1e293b; margin: 0; }
  .header-right .domain { font-size: 12px; color: #64748b; margin: 2px 0 0; }
  .body { padding: 0 36px 36px; }
  .generated-date { font-size: 11px; color: #94a3b8; margin-bottom: 28px; }
  .section { margin-bottom: 28px; padding: 20px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; }
  .section-title { font-size: 15px; font-weight: 700; color: ${primaryColor}; margin-bottom: 12px; }
  .score-gauge { text-align: center; padding: 20px 0; }
  .score-number { font-size: 56px; font-weight: 800; line-height: 1; }
  .score-label { font-size: 12px; color: #64748b; margin-top: 4px; }
  .score-bar { max-width: 320px; margin: 12px auto 0; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; }
  .score-bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
  .stat-grid { display: flex; gap: 12px; flex-wrap: wrap; }
  .stat-card { flex: 1; min-width: 100px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }
  .stat-value { font-size: 28px; font-weight: 700; }
  .stat-label { font-size: 11px; color: #64748b; margin-top: 2px; }
  .issue { padding: 12px 0; border-bottom: 1px solid #e2e8f0; }
  .issue:last-child { border-bottom: none; }
  .issue-title { font-weight: 600; font-size: 13px; color: #0f172a; }
  .issue-desc { font-size: 12px; color: #475569; margin-top: 4px; }
  .issue-rec { font-size: 12px; color: #2563eb; margin-top: 2px; }
  .badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; }
  .badge-critical { background: #fef2f2; color: #dc2626; }
  .badge-warning { background: #fffbeb; color: #d97706; }
  .badge-passed { background: #f0fdf4; color: #16a34a; }
  .footer { text-align: center; padding: 24px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
</style>
</head>
<body>
<div class="report" ${headerBorder}>
  <div class="header" style="background:${headerBg};">
    ${logoHtml}
    <div class="header-right">
      <p class="project-name" style="color:#f8fafc;">${escapeHtml(payload.projectName)}</p>
      <p class="domain" style="color:#cbd5e1;">${escapeHtml(payload.domain)}</p>
    </div>
  </div>
  <div class="body">
    <p class="generated-date">Generated ${new Date(payload.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    ${sectionsHtml}
  </div>
  <div class="footer">${brand?.reportFooterText ? escapeHtml(brand.reportFooterText) : 'RankEngine AI — Automated SEO Audit Report'}</div>
</div>
</body>
</html>`;
}

// ── Section Renderers ──────────────────────────────────────────────────

function renderSection(section: ReportSection, primaryColor: string): string {
  switch (section.type) {
    case 'score_gauge':
      return renderScoreGauge(section, primaryColor);
    case 'table':
      return renderTable(section);
    case 'checklist':
      return renderChecklist(section);
    case 'text':
      return renderText(section);
    default:
      return `<div class="section"><div class="section-title">${escapeHtml(section.title)}</div><p style="font-size:12px;color:#64748b;">${JSON.stringify(section.data)}</p></div>`;
  }
}

function renderScoreGauge(section: ReportSection, _primaryColor: string): string {
  const score = Number(section.data.score) || 0;
  const label = String(section.data.label || 'SEO Health Score');

  let barColor = '#dc2626';
  if (score >= 80) barColor = '#16a34a';
  else if (score >= 50) barColor = '#d97706';

  return `<div class="section">
    <div class="section-title">${escapeHtml(section.title)}</div>
    <div class="score-gauge">
      <div class="score-number" style="color:${barColor};">${score}</div>
      <div class="score-label">${escapeHtml(label)}</div>
      <div class="score-bar">
        <div class="score-bar-fill" style="width:${score}%;background:${barColor};"></div>
      </div>
    </div>
  </div>`;
}

function renderTable(section: ReportSection): string {
  const headers = (section.data.headers as string[]) || [];
  const rows = (section.data.rows as string[][]) || [];
  const colorMap = section.data.colorMap as Record<string, string> | undefined;

  return `<div class="section">
    <div class="section-title">${escapeHtml(section.title)}</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="background:#e2e8f0;text-align:left;">
        ${headers.map((h) => `<th style="padding:8px 12px;font-weight:600;color:#475569;">${escapeHtml(h)}</th>`).join('')}
      </tr></thead>
      <tbody>
        ${rows
          .map(
            (row) => `<tr style="border-bottom:1px solid #e2e8f0;">
          ${row
            .map((cell, ci) => {
              const color = colorMap && headers[ci] ? colorMap[headers[ci]] : undefined;
              const colorStyle = color ? `style="color:${color};font-weight:600;"` : '';
              return `<td style="padding:8px 12px;color:#334155;" ${colorStyle}>${escapeHtml(cell)}</td>`;
            })
            .join('')}
        </tr>`
          )
          .join('')}
      </tbody>
    </table>
  </div>`;
}

function renderChecklist(section: ReportSection): string {
  const items =
    (section.data.items as Array<{
      severity: string;
      description: string;
      recommendation?: string;
    }>) || [];

  return `<div class="section">
    <div class="section-title">${escapeHtml(section.title)}</div>
    ${
      items.length === 0
        ? '<p style="font-size:12px;color:#64748b;">No issues found.</p>'
        : items
            .map((item) => {
              const badgeClass =
                item.severity === 'critical'
                  ? 'badge-critical'
                  : item.severity === 'warning'
                    ? 'badge-warning'
                    : 'badge-passed';
              return `<div class="issue">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span class="badge ${badgeClass}">${escapeHtml(item.severity)}</span>
          <span class="issue-title">${escapeHtml(item.description)}</span>
        </div>
        ${item.recommendation ? `<div class="issue-rec">Recommendation: ${escapeHtml(item.recommendation)}</div>` : ''}
      </div>`;
            })
            .join('')
    }
  </div>`;
}

function renderText(section: ReportSection): string {
  const text = String(section.data.text || '');
  return `<div class="section">
    <div class="section-title">${escapeHtml(section.title)}</div>
    <p style="font-size:12px;color:#475569;line-height:1.6;">${escapeHtml(text)}</p>
  </div>`;
}

// ── Security ───────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Puppeteer PDF Rendering ───────────────────────────────────────────

export async function renderPdf(html: string): Promise<Buffer> {
  if (process.env.NODE_ENV === 'test') {
    return Buffer.from('%PDF-1.4 Mock PDF document\n' + (html ? html.slice(0, 50) : ''));
  }

  const launchOptions: any = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };

  const fs = require('fs');
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  } else if (fs.existsSync('/usr/bin/chromium-browser')) {
    launchOptions.executablePath = '/usr/bin/chromium-browser';
  } else if (fs.existsSync('/usr/bin/chromium')) {
    launchOptions.executablePath = '/usr/bin/chromium';
  }

  try {
    const browser = await puppeteer.launch(launchOptions);
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        printBackground: true,
      });
      return pdfBuffer;
    } finally {
      await browser.close();
    }
  } catch (err: any) {
    console.warn('[PDF Export]: Puppeteer launch unavailable, generating HTML report document fallback:', err.message);
    return Buffer.from(html, 'utf-8');
  }
}
