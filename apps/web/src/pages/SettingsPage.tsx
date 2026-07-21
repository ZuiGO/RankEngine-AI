import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../lib/api';
import { Card, CardBody, Badge, Button, EmptyState } from '../components/ui';

interface SubscriptionInfo {
  plan: string;
  status: string;
  seats: number;
  projects: number;
  keywords: number;
  dataProviderMonthlyLimit: number;
  currentPeriodEnd: string;
}

interface TeamInvite {
  _id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

export default function SettingsPage() {
  const location = useLocation();
  const [digestEnabled, setDigestEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [team, setTeam] = useState<TeamInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get<any>('/auth/me'),
      api.get<SubscriptionInfo>('/billing/subscription').catch(() => null),
      api.get<TeamInvite[]>('/billing/team').catch(() => []),
    ])
      .then(([me, sub, teamData]) => {
        setDigestEnabled(me.data.emailDigestEnabled ?? true);
        setSubscription(sub?.data ?? null);
        setTeam(teamData ?? []);
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
      //
    } finally {
      setSaving(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError('');
    setInviting(true);
    try {
      await api.post('/billing/invite', { email: inviteEmail });
      setInviteEmail('');
      const { data } = await api.get<TeamInvite[]>('/billing/team');
      setTeam(data);
    } catch (err: any) {
      setInviteError(err?.response?.data?.error || 'Failed to send invite');
    } finally {
      setInviting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-4 animate-pulse">
        <div className="h-6 w-48 bg-app-surface-raised rounded" />
        <div className="h-32 bg-app-surface border border-app-border rounded-2xl" />
      </div>
    );
  }

  const planBadgeVariant = subscription?.plan === 'free' ? 'default' : 'success';

  const tabs = [
    { label: 'General', path: '/settings' },
    { label: 'Team', path: '/settings/team' },
    { label: 'Branding', path: '/settings/branding' },
    { label: 'Billing', path: '/settings/billing' },
  ];

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Account Settings</h1>
        <p className="text-app-text-muted text-sm mt-1">Manage your plan, team, and preferences.</p>
      </div>

      {/* Sub-navigation */}
      <div className="flex gap-1 border-b border-app-border pb-0">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition-all duration-150 ${
                isActive
                  ? 'bg-app-surface text-white border border-app-border border-b-app-surface -mb-px'
                  : 'text-app-text-muted hover:text-app-text hover:bg-app-surface-raised/50'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {/* Subscription */}
      {subscription && (
        <Card>
          <CardBody>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-white">Subscription</h2>
              <Badge variant={planBadgeVariant}>
                {subscription.plan.charAt(0).toUpperCase() + subscription.plan.slice(1)}
              </Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
              {[
                { label: 'Projects', value: subscription.projects },
                { label: 'Keywords', value: subscription.keywords },
                { label: 'Team Seats', value: subscription.seats },
                { label: 'API Calls', value: subscription.dataProviderMonthlyLimit.toLocaleString() },
              ].map((stat) => (
                <div key={stat.label} className="bg-app-base rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-white">{stat.value}</p>
                  <p className="text-2xs text-app-text-muted">{stat.label}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-app-text-muted">
                Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
              </span>
              <Link
                to="/pricing"
                className="text-xs text-app-signal hover:text-app-signal/80 font-semibold transition-all duration-150"
              >
                Change Plan →
              </Link>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Team */}
      <Card>
        <CardBody>
          <h2 className="text-sm font-bold text-white mb-4">Team Members</h2>

          <form onSubmit={handleInvite} className="flex gap-3 items-end mb-4">
            <div className="flex-1">
              <label className="block text-2xs font-semibold text-app-text-muted mb-1">Invite by email</label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@agency.com"
                className="w-full bg-app-base border border-app-border focus:border-app-signal focus:ring-1 focus:ring-app-signal/50 rounded-lg text-xs px-3 py-2 text-white placeholder-app-text-muted outline-none transition-all duration-150"
              />
            </div>
            <Button type="submit" variant="primary" loading={inviting}>
              Send Invite
            </Button>
          </form>

          {inviteError && (
            <p className="text-xs text-rose-400 mb-3">{inviteError}</p>
          )}

          {team.length === 0 ? (
            <EmptyState compact title="No team invites sent yet" />
          ) : (
            <div className="space-y-2">
              {team.map((invite) => (
                <div
                  key={invite._id}
                  className="flex items-center justify-between bg-app-base rounded-lg px-3 py-2"
                >
                  <div>
                    <p className="text-xs text-app-text font-medium">{invite.email}</p>
                    <p className="text-2xs text-app-text-muted capitalize">{invite.role}</p>
                  </div>
                  <Badge
                    variant={
                      invite.status === 'accepted'
                        ? 'success'
                        : invite.status === 'expired'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {invite.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Email Preferences */}
      <Card>
        <CardBody>
          <h2 className="text-sm font-bold text-white mb-4">Email Preferences</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-app-text">Weekly email digest</p>
              <p className="text-xs text-app-text-muted mt-0.5">
                Receive a Monday morning summary of audits, rankings, and alerts.
              </p>
            </div>
            <button
              onClick={() => handleToggle(!digestEnabled)}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-150 ${
                digestEnabled ? 'bg-app-signal' : 'bg-app-border'
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
        </CardBody>
      </Card>
    </div>
  );
}
