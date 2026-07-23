import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { API_BASE } from '../lib/api';
import api from '../lib/api';
import { Card, Badge, Button } from '../components/ui';
import { Settings, CheckCircle, Link2, AlertTriangle, RefreshCw, Unlink } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────

interface GoogleIntegrationStatus {
  connected: boolean;
  gaPropertyId: string | null;
  gscSiteUrl: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  scopes: string[];
}

interface AvailableProperties {
  gaProperties: { id: string; displayName: string; webDataStreamId: string }[];
  gscSites: { siteUrl: string; permissionLevel: string }[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  danger = false,
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-app-surface border border-app-border rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h3 className="text-base font-bold text-white mb-2">{title}</h3>
        <p className="text-sm text-app-text-muted mb-6">{message}</p>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="text-sm text-app-text-muted hover:text-white px-4 py-2 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            className="text-sm px-4 py-2"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────

export default function ProjectSettingsPage() {
  const { id } = useParams<{ id: string }>();

  const [status, setStatus] = useState<GoogleIntegrationStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');

  const [properties, setProperties] = useState<AvailableProperties | null>(null);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertiesError, setPropertiesError] = useState('');

  const [selectedGaProperty, setSelectedGaProperty] = useState('');
  const [selectedGscSite, setSelectedGscSite] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  // ── Load status ────────────────────────────────────────────────────
  const loadStatus = async () => {
    if (!id) return;
    setStatusLoading(true);
    setStatusError('');
    try {
      const { data } = await api.get<GoogleIntegrationStatus>(`/projects/${id}/integrations/google/status`);
      setStatus(data);
      if (data.gaPropertyId) setSelectedGaProperty(data.gaPropertyId);
      if (data.gscSiteUrl) setSelectedGscSite(data.gscSiteUrl);
    } catch (err: any) {
      setStatusError(err?.response?.data?.error || 'Failed to load Google integration status');
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, [id]);

  // ── Load available properties when connected ───────────────────────
  useEffect(() => {
    if (!status?.connected || !id) return;
    setPropertiesLoading(true);
    setPropertiesError('');
    api.get<AvailableProperties>(`/projects/${id}/integrations/google/available-properties`)
      .then(({ data }) => {
        setProperties(data);
        // Pre-select if not already selected
        if (!selectedGaProperty && data.gaProperties.length > 0) {
          setSelectedGaProperty(data.gaProperties[0].id);
        }
        if (!selectedGscSite && data.gscSites.length > 0) {
          setSelectedGscSite(data.gscSites[0].siteUrl);
        }
      })
      .catch((err: any) => {
        setPropertiesError(err?.response?.data?.error || 'Failed to fetch Google properties');
      })
      .finally(() => setPropertiesLoading(false));
  }, [status?.connected, id]);

  // ── Connect → full page redirect (OAuth) ──────────────────────────
  const handleConnect = () => {
    window.location.href = `${API_BASE}/integrations/google/connect?projectId=${id}`;
  };

  // ── Save property/site selection ───────────────────────────────────
  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    setSaveSuccess(false);
    try {
      await api.patch(`/projects/${id}/integrations/google`, {
        gaPropertyId: selectedGaProperty || null,
        gscSiteUrl: selectedGscSite || null,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      loadStatus();
    } catch (err: any) {
      setStatusError(err?.response?.data?.error || 'Failed to save integration settings');
    } finally {
      setSaving(false);
    }
  };

  // ── Disconnect ─────────────────────────────────────────────────────
  const handleDisconnect = async () => {
    if (!id) return;
    setDisconnecting(true);
    setShowDisconnectConfirm(false);
    try {
      await api.post(`/projects/${id}/integrations/google/disconnect`);
      setStatus(null);
      setProperties(null);
      setSelectedGaProperty('');
      setSelectedGscSite('');
      loadStatus();
    } catch (err: any) {
      setStatusError(err?.response?.data?.error || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <Link
          to={`/projects/${id}`}
          className="text-xs text-app-signal hover:text-app-signal/80 font-semibold flex items-center space-x-1"
        >
          <span>← Back to Project</span>
        </Link>
        <span className="text-app-text-muted text-xs flex items-center gap-1.5">
          <Settings className="h-3.5 w-3.5" />
          Project Settings
        </span>
      </div>

      {statusError && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg mb-6">
          {statusError}
        </div>
      )}

      {saveSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs p-3 rounded-lg mb-6 flex items-center gap-2">
          <CheckCircle className="h-3.5 w-3.5" />
          Google integration settings saved successfully.
        </div>
      )}

      {/* Google Integration Panel */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-5">
          {/* Google G icon */}
          <div className="h-10 w-10 rounded-xl bg-white flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" className="h-6 w-6" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Google Analytics & Search Console</h2>
            <p className="text-xs text-app-text-muted mt-0.5">
              Connect your Google account to enrich Content Performance reports with real traffic and search data.
            </p>
          </div>
        </div>

        {statusLoading ? (
          <div className="flex items-center gap-2 text-xs text-app-text-muted animate-pulse py-4">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Loading integration status…
          </div>
        ) : !status?.connected ? (
          /* ── Not connected ── */
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-app-text-muted">
              <div className="h-2 w-2 rounded-full bg-app-text-muted/40" />
              Not connected
            </div>
            <p className="text-xs text-app-text-muted leading-relaxed max-w-lg">
              Connecting your Google account will enable per-page sessions, engagement rate, clicks,
              impressions, CTR, and average position to be shown alongside on-page SEO scores in
              Content Performance reports.
            </p>
            <Button
              variant="primary"
              onClick={handleConnect}
              className="flex items-center gap-2"
            >
              <Link2 className="h-4 w-4" />
              Connect Google Account
            </Button>
          </div>
        ) : (
          /* ── Connected ── */
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-emerald-400">
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Connected
              </div>
              <button
                onClick={() => setShowDisconnectConfirm(true)}
                disabled={disconnecting}
                className="flex items-center gap-1.5 text-xs text-rose-400 hover:text-rose-300 transition-colors disabled:opacity-50"
              >
                <Unlink className="h-3.5 w-3.5" />
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>

            {/* Scopes */}
            <div className="flex flex-wrap gap-1.5">
              {(status.scopes ?? []).map((s) => (
                <Badge key={s} variant="info" className="text-[10px] font-mono">
                  {s.split('/').pop()}
                </Badge>
              ))}
            </div>

            {/* Meta */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              {status.connectedAt && (
                <div className="bg-app-surface-raised rounded-lg p-3 border border-app-border">
                  <p className="text-app-text-muted mb-1">Connected</p>
                  <p className="text-app-text font-medium">{new Date(status.connectedAt).toLocaleDateString()}</p>
                </div>
              )}
              {status.lastSyncedAt && (
                <div className="bg-app-surface-raised rounded-lg p-3 border border-app-border">
                  <p className="text-app-text-muted mb-1">Last Synced</p>
                  <p className="text-app-text font-medium">{new Date(status.lastSyncedAt).toLocaleDateString()}</p>
                </div>
              )}
            </div>

            {/* Property/Site picker */}
            {propertiesLoading ? (
              <div className="flex items-center gap-2 text-xs text-app-text-muted animate-pulse">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Loading available properties…
              </div>
            ) : propertiesError ? (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                {propertiesError}
              </div>
            ) : properties ? (
              <div className="space-y-4">
                {/* GA4 Property */}
                <div>
                  <label className="block text-xs font-semibold text-app-text mb-2">
                    GA4 Property
                  </label>
                  {properties.gaProperties.length === 0 ? (
                    <p className="text-xs text-app-text-muted">No GA4 properties found for this Google account.</p>
                  ) : (
                    <select
                      value={selectedGaProperty}
                      onChange={(e) => setSelectedGaProperty(e.target.value)}
                      className="w-full text-sm bg-app-base border border-app-border rounded-lg px-3 py-2 text-app-text outline-none focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 transition-colors"
                    >
                      <option value="">— None —</option>
                      {properties.gaProperties.map((p) => (
                        <option key={p.id} value={p.id}>{p.displayName} ({p.id})</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Search Console Site */}
                <div>
                  <label className="block text-xs font-semibold text-app-text mb-2">
                    Search Console Site
                  </label>
                  {properties.gscSites.length === 0 ? (
                    <p className="text-xs text-app-text-muted">No Search Console sites found for this Google account.</p>
                  ) : (
                    <select
                      value={selectedGscSite}
                      onChange={(e) => setSelectedGscSite(e.target.value)}
                      className="w-full text-sm bg-app-base border border-app-border rounded-lg px-3 py-2 text-app-text outline-none focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 transition-colors"
                    >
                      <option value="">— None —</option>
                      {properties.gscSites.map((s) => (
                        <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl} ({s.permissionLevel})</option>
                      ))}
                    </select>
                  )}
                </div>

                <Button
                  variant="primary"
                  onClick={handleSave}
                  loading={saving}
                  disabled={saving}
                  className="mt-2"
                >
                  Save Integration Settings
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {/* Confirm disconnect dialog */}
      {showDisconnectConfirm && (
        <ConfirmDialog
          title="Disconnect Google Account?"
          message="This will remove the stored OAuth token and disconnect GA4 and Search Console. Content Performance reports will no longer include traffic or search data."
          confirmLabel="Disconnect"
          danger
          onConfirm={handleDisconnect}
          onCancel={() => setShowDisconnectConfirm(false)}
        />
      )}
    </div>
  );
}
