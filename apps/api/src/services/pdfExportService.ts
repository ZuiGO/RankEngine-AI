import puppeteer from 'puppeteer';
import crypto from 'crypto';

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
  whiteLabel?: WhiteLabelConfig,
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

function renderScoreGauge(section: ReportSection, primaryColor: string): string {
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
        ${rows.map((row) => `<tr style="border-bottom:1px solid #e2e8f0;">
          ${row.map((cell, ci) => {
            const color = colorMap && headers[ci] ? colorMap[headers[ci]] : undefined;
            const colorStyle = color ? `style="color:${color};font-weight:600;"` : '';
            return `<td style="padding:8px 12px;color:#334155;" ${colorStyle}>${escapeHtml(cell)}</td>`;
          }).join('')}
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

function renderChecklist(section: ReportSection): string {
  const items = (section.data.items as Array<{ severity: string; description: string; recommendation?: string }>) || [];

  return `<div class="section">
    <div class="section-title">${escapeHtml(section.title)}</div>
    ${items.length === 0 ? '<p style="font-size:12px;color:#64748b;">No issues found.</p>' : items.map((item) => {
      const badgeClass = item.severity === 'critical' ? 'badge-critical' : item.severity === 'warning' ? 'badge-warning' : 'badge-passed';
      return `<div class="issue">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span class="badge ${badgeClass}">${escapeHtml(item.severity)}</span>
          <span class="issue-title">${escapeHtml(item.description)}</span>
        </div>
        ${item.recommendation ? `<div class="issue-rec">Recommendation: ${escapeHtml(item.recommendation)}</div>` : ''}
      </div>`;
    }).join('')}
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
    return Buffer.from('mock-pdf');
  }
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
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
}
