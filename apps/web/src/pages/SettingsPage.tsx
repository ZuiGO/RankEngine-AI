import { useState, useEffect } from 'react';
import api from '../lib/api';

export default function SettingsPage() {
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get<any>('/auth/me')
      .then(({ data }) => {
        setDigestEnabled(data.emailDigestEnabled ?? true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (enabled: boolean) => {
    setSaving(true);
    setSaved(false);
    try {
      await api.patch('/auth/preferences', { emailDigestEnabled: enabled });
      setDigestEnabled(enabled);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // silently ignore
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-4 animate-pulse">
        <div className="h-6 w-48 bg-slate-800 rounded" />
        <div className="h-32 bg-slate-900 border border-slate-800 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Account Settings</h1>
        <p className="text-slate-400 text-sm mt-1">Manage your preferences and notifications.</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
        <h2 className="text-sm font-bold text-white mb-4">Email Preferences</h2>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-200">Weekly email digest</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Receive a Monday morning summary of audits, rankings, and alerts.
            </p>
          </div>
          <button
            onClick={() => handleToggle(!digestEnabled)}
            disabled={saving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              digestEnabled ? 'bg-indigo-600' : 'bg-slate-700'
            } disabled:opacity-50`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                digestEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {saved && (
          <p className="mt-3 text-xs text-emerald-400 font-medium">Preference saved.</p>
        )}
      </div>
    </div>
  );
}
