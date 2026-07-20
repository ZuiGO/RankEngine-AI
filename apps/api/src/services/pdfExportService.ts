/**
 * PDF Export Service — foundation for white-label reporting.
 *
 * Future: integrate a PDF generation library (e.g. puppeteer, pdfkit, or
 * a headless-chrome-based service) to render project audit reports,
 * keyword rank charts, backlink profiles, and AI visibility scores into
 * branded PDF documents.
 *
 * Placeholder implementation returns structured report data that a
 * front-end or worker can consume.
 */

export interface ReportSection {
  title: string;
  type: 'score_gauge' | 'table' | 'chart' | 'checklist' | 'text';
  data: Record<string, unknown>;
}

export interface WhiteLabelConfig {
  agencyName: string;
  agencyLogoUrl?: string;
  primaryColor?: string;
}

export interface ReportPayload {
  projectId: string;
  projectName: string;
  domain: string;
  generatedAt: string;
  sections: ReportSection[];
  whiteLabel?: WhiteLabelConfig;
}

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

export function generateReportHtml(payload: ReportPayload): string {
  const brand = payload.whiteLabel;
  const headerStyle = brand?.primaryColor
    ? `style="border-top: 4px solid ${brand.primaryColor};"`
    : '';

  const logoHtml = brand?.agencyLogoUrl
    ? `<img src="${brand.agencyLogoUrl}" alt="${brand.agencyName}" style="height:32px;" />`
    : `<h1 style="font-size:18px;font-weight:700;">${brand?.agencyName || payload.projectName}</h1>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${payload.projectName} — SEO Report</title></head>
<body style="font-family:sans-serif;background:#f8fafc;padding:40px;">
  <div ${headerStyle} style="max-width:800px;margin:0 auto;background:white;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08);overflow:hidden;">
    <div style="padding:24px 32px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
      ${logoHtml}
      <div style="text-align:right;">
        <p style="margin:0;font-size:12px;color:#64748b;">${payload.projectName}</p>
        <p style="margin:0;font-size:11px;color:#94a3b8;">${payload.domain}</p>
      </div>
    </div>
    <div style="padding:32px;">
      <p style="font-size:12px;color:#94a3b8;margin-bottom:24px;">Generated ${new Date(payload.generatedAt).toLocaleDateString()}</p>
      ${payload.sections
        .map(
          (s) => `
        <div style="margin-bottom:24px;padding:16px;background:#f8fafc;border-radius:6px;">
          <h2 style="margin:0 0 8px;font-size:14px;font-weight:600;color:#1e293b;">${s.title}</h2>
          <p style="margin:0;font-size:12px;color:#64748b;">${s.type} — ${JSON.stringify(s.data)}</p>
        </div>`,
        )
        .join('')}
    </div>
  </div>
</body>
</html>`;
}
