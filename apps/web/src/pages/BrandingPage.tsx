import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardBody, Button } from '../components/ui';
import api from '../lib/api';

interface OrgBranding {
  _id: string;
  name: string;
  ownerId: string;
  logoUrl: string | null;
  primaryColor: string | null;
  reportFooterText: string | null;
}

const DEFAULT_COLOR = '#4f46e5';

export default function BrandingPage() {
  const [org, setOrg] = useState<OrgBranding | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_COLOR);
  const [reportFooterText, setReportFooterText] = useState('');

  const [upgradeRequired, setUpgradeRequired] = useState(false);

  const fetchOrg = async () => {
    setLoading(true);
    setError('');
    try {
      const orgsRes = await api.get<OrgBranding[]>('/organizations');
      const myOrg = orgsRes.data[0];
      if (!myOrg) {
        setError('No organization found.');
        return;
      }

      // Fetch full org details including branding
      const detailRes = await api.get<OrgBranding>(`/organizations/${myOrg._id}`);
      const branding = detailRes.data;

      setOrg(branding);
      setPrimaryColor(branding.primaryColor || DEFAULT_COLOR);
      setReportFooterText(branding.reportFooterText || '');
      if (branding.logoUrl) {
        const url = branding.logoUrl.startsWith('http') ? branding.logoUrl : `http://localhost:3000${branding.logoUrl}`;
        setLogoPreview(url);
      }
    } catch (err: any) {
      if (err?.response?.status === 402) {
        setUpgradeRequired(true);
      } else {
        setError(err?.response?.data?.error || 'Failed to load organization.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrg();
  }, []);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const formData = new FormData();
      if (logoFile) {
        formData.append('logo', logoFile);
      } else if (logoPreview === null && org?.logoUrl) {
        // User removed the logo — send empty string to clear
        formData.append('logo', '');
      }
      formData.append('primaryColor', primaryColor);
      formData.append('reportFooterText', reportFooterText);

      await api.post(`/organizations/${org!._id}/branding`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setSuccess(true);
      await fetchOrg();
    } catch (err: any) {
      if (err?.response?.status === 402) {
        setUpgradeRequired(true);
      } else {
        setError(err?.response?.data?.error || 'Failed to save branding.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-4 animate-pulse">
        <div className="h-6 w-48 bg-slate-800 rounded" />
        <div className="h-40 bg-slate-900 border border-slate-800 rounded-2xl" />
      </div>
    );
  }

  if (upgradeRequired) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
          <Link to="/settings" className="hover:text-indigo-400">Settings</Link>
          <span>/</span>
          <span className="text-slate-300">Branding</span>
        </div>
        <Card>
          <CardBody className="text-center py-12">
            <h2 className="text-lg font-bold text-white mb-2">White-Label Branding</h2>
            <p className="text-sm text-slate-400 mb-6">
              Custom branding is available on the <span className="text-violet-400 font-semibold">Agency</span> plan.
              Upgrade to add your logo, brand colors, and custom footer to exported PDF reports.
            </p>
            <Link to="/settings/billing">
              <Button variant="primary">Upgrade to Agency</Button>
            </Link>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <div>
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
          <Link to="/settings" className="hover:text-indigo-400 transition-colors">
            Settings
          </Link>
          <span>/</span>
          <span className="text-slate-300">Branding</span>
        </div>
        <h1 className="text-2xl font-bold text-white">White-Label Branding</h1>
        <p className="text-slate-400 text-sm mt-1">
          Customize the look of exported PDF audit reports with your agency's branding.
        </p>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-4 rounded-xl">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs p-4 rounded-xl flex items-center justify-between">
          <span className="font-semibold">Branding saved successfully!</span>
          <button onClick={() => setSuccess(false)} className="text-emerald-400/60 hover:text-emerald-300 ml-4">
            Dismiss
          </button>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Logo Upload */}
        <Card>
          <CardBody>
            <h2 className="text-sm font-bold text-white mb-3">Agency Logo</h2>
            <p className="text-xs text-slate-500 mb-4">
              PNG, JPEG, WebP, or SVG. Max 2 MB. Recommended: transparent PNG at least 200 px wide.
            </p>
            <div className="flex items-center gap-4 flex-wrap">
              {logoPreview ? (
                <div className="relative">
                  <img
                    src={logoPreview}
                    alt="Logo preview"
                    className="h-10 rounded object-contain border border-slate-700 bg-white px-2"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveLogo}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-rose-600 rounded-full flex items-center justify-center text-white text-xs font-bold hover:bg-rose-500"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div className="h-10 w-32 rounded border border-dashed border-slate-700 flex items-center justify-center text-2xs text-slate-600">
                  No logo
                </div>
              )}
              <label className="cursor-pointer">
                <span className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white transition-all">
                  Choose File
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleLogoChange}
                  className="hidden"
                />
              </label>
            </div>
          </CardBody>
        </Card>

        {/* Brand Color */}
        <Card>
          <CardBody>
            <h2 className="text-sm font-bold text-white mb-3">Brand Color</h2>
            <p className="text-xs text-slate-500 mb-4">
              Used as the accent color in report headers and section titles.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-10 h-10 rounded cursor-pointer border border-slate-700 bg-transparent"
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#4f46e5"
                className="bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs px-3 py-2 text-white font-mono w-28 outline-none transition-all"
              />
            </div>
          </CardBody>
        </Card>

        {/* Footer Text */}
        <Card>
          <CardBody>
            <h2 className="text-sm font-bold text-white mb-3">Report Footer</h2>
            <p className="text-xs text-slate-500 mb-4">
              Custom text shown at the bottom of every exported PDF report (e.g. your agency's contact info).
            </p>
            <textarea
              value={reportFooterText}
              onChange={(e) => setReportFooterText(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Powered by My Agency — hello@myagency.com"
              className="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 rounded-lg text-xs px-3 py-2 text-white placeholder-slate-700 outline-none transition-all resize-none"
            />
            <p className="text-2xs text-slate-600 mt-1 text-right">{reportFooterText.length}/500</p>
          </CardBody>
        </Card>

        {/* Live Preview */}
        <Card>
          <CardBody>
            <h2 className="text-sm font-bold text-white mb-3">Report Header Preview</h2>
            <div
              className="rounded-lg overflow-hidden border border-slate-700"
              style={{ borderTop: `4px solid ${primaryColor}` }}
            >
              <div className="flex items-center justify-between px-6 py-4" style={{ background: primaryColor }}>
                <div>
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo" className="h-8 object-contain" />
                  ) : (
                    <span className="text-sm font-bold text-white">{org?.name || 'Your Agency'}</span>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-white/90">Example Project</p>
                  <p className="text-2xs text-white/70">https://example.com</p>
                </div>
              </div>
              <div className="p-6 bg-slate-950">
                <div className="text-center py-6">
                  <div className="text-5xl font-extrabold" style={{ color: primaryColor }}>72</div>
                  <p className="text-2xs text-slate-500 mt-1">SEO Health Score</p>
                  <div className="max-w-xs mx-auto mt-3 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: '72%', background: primaryColor }} />
                  </div>
                </div>
                {reportFooterText && (
                  <div className="mt-6 pt-4 border-t border-slate-800 text-center">
                    <p className="text-2xs text-slate-600">{reportFooterText}</p>
                  </div>
                )}
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Save */}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={saving}>
            Save Branding
          </Button>
        </div>
      </form>
    </div>
  );
}
