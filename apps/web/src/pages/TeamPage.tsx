import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Card, CardBody, Badge, Button, EmptyState } from '../components/ui';
import api from '../lib/api';

interface OrgMember {
  userId: string;
  email: string;
  role: string;
  joinedAt: string;
}

interface PendingInvite {
  _id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  createdAt: string;
}

interface OrgInfo {
  _id: string;
  name: string;
  ownerId: string;
}

export default function TeamPage() {
  const { profile } = useAuth();

  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');

  const [removing, setRemoving] = useState<string | null>(null);

  const fetchTeam = async () => {
    setLoading(true);
    setError('');
    try {
      const meRes = await api.get<{ id: string }>('/auth/me');
      const userId = meRes.data.id;

      const orgsRes = await api.get<OrgInfo[]>('/organizations');
      const myOrg = orgsRes.data[0];
      if (!myOrg) {
        setError('No organization found. Contact support.');
        return;
      }
      setOrg(myOrg);

      const teamRes = await api.get<{ members: OrgMember[]; invites: PendingInvite[] }>(
        `/organizations/${myOrg._id}/members`
      );
      setMembers(teamRes.data.members);
      setInvites(teamRes.data.invites);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load team data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeam();
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError('');
    setInviting(true);
    try {
      await api.post(`/organizations/${org!._id}/invites`, {
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteEmail('');
      await fetchTeam();
    } catch (err: any) {
      setInviteError(err?.response?.data?.error || 'Failed to send invite');
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setRemoving(userId);
    try {
      await api.delete(`/organizations/${org!._id}/members/${userId}`);
      await fetchTeam();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to remove member');
    } finally {
      setRemoving(null);
    }
  };

  const currentUserId = profile?.id;
  const isOwner = members.some((m) => m.role === 'owner' && m.userId === currentUserId);
  const isAdmin = isOwner || members.some((m) => m.role === 'admin' && m.userId === currentUserId);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-4 animate-pulse">
        <div className="h-6 w-36 bg-app-surface-raised rounded" />
        <div className="h-40 bg-app-surface border border-app-border rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <div>
        <div className="flex items-center gap-2 text-xs text-app-text-muted mb-1">
          <Link to="/settings" className="hover:text-app-signal transition-all duration-150">
            Settings
          </Link>
          <span>/</span>
          <span className="text-app-text">Team</span>
        </div>
        <h1 className="text-2xl font-bold text-white">Team Management</h1>
        <p className="text-app-text-muted text-sm mt-1">
          {org ? `Manage members for ${org.name}` : 'Invite and manage your team members.'}
        </p>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-4 rounded-xl">
          {error}
        </div>
      )}

      {isAdmin && (
        <Card>
          <CardBody>
            <h2 className="text-sm font-bold text-white mb-4">Invite Member</h2>
            <form onSubmit={handleInvite} className="flex gap-3 items-end flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-2xs font-semibold text-app-text-muted mb-1">
                  Email address
                </label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@agency.com"
                  className="w-full bg-app-base border border-app-border focus:border-app-signal rounded-lg text-xs px-3 py-2 text-white placeholder-app-text-muted outline-none transition-all duration-150"
                />
              </div>
              <div>
                <label className="block text-2xs font-semibold text-app-text-muted mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'member' | 'admin')}
                  className="bg-app-base border border-app-border focus:border-app-signal rounded-lg text-xs px-3 py-2 text-white outline-none transition-all duration-150"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <Button type="submit" variant="primary" loading={inviting}>
                Send Invite
              </Button>
            </form>
            {inviteError && (
              <p className="text-xs text-rose-400 mt-3">{inviteError}</p>
            )}
          </CardBody>
        </Card>
      )}

      {/* Current Members */}
      <Card>
        <CardBody>
          <h2 className="text-sm font-bold text-white mb-4">
            Members ({members.length})
          </h2>
          {members.length === 0 ? (
            <EmptyState compact title="No members found." />
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center justify-between bg-app-base rounded-lg px-4 py-3"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-app-signal/20 border border-app-signal/10 flex items-center justify-center text-xs font-bold text-app-signal flex-shrink-0">
                      {m.email.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-app-text font-medium truncate">
                        {m.email}
                      </p>
                      <p className="text-2xs text-app-text-muted">
                        Joined {new Date(m.joinedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <Badge
                      variant={
                        m.role === 'owner'
                          ? 'info'
                          : m.role === 'admin'
                            ? 'warning'
                            : 'default'
                      }
                    >
                      {m.role}
                    </Badge>
                    {isOwner && m.role !== 'owner' && (
                      <Button
                        variant="danger"
                        loading={removing === m.userId}
                        onClick={() => handleRemove(m.userId)}
                        className="!px-2 !py-1 !text-2xs"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Pending Invites */}
      {invites.length > 0 && (
        <Card>
          <CardBody>
            <h2 className="text-sm font-bold text-white mb-4">
              Pending Invites ({invites.length})
            </h2>
            <div className="space-y-2">
              {invites.map((inv) => (
                <div
                  key={inv._id}
                  className="flex items-center justify-between bg-app-base rounded-lg px-4 py-3"
                >
                  <div>
                    <p className="text-xs text-app-text font-medium">{inv.email}</p>
                    <p className="text-2xs text-app-text-muted">
                      Sent {new Date(inv.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge
                    variant={
                      inv.status === 'accepted'
                        ? 'success'
                        : inv.status === 'expired'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {inv.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
