// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useAuth } from '../../stores/useAuth';
import Avatar from '../../components/Avatar';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { SkeletonRows } from '../../components/ui/skeleton';
import UserModal from './UserModal';
import { Metric } from './AdminPrimitives';
import { fmtBytes, fmtDateTime } from './adminShared';
import { ActivityPanel, MembershipsPanel, SessionsPanel, TokensPanel } from './UserDetailPanels';
import type { AdminUserDetail } from '../../types/api';
import { useT } from '../../i18n';

/** Fiche détaillée d'un compte (refonte admin) : profil, projets, sessions, activité. */
export default function UserDetailTab() {
  const t = useT();
  const { id } = useParams();
  const userId = Number(id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const meId = useAuth((s) => s.user?.id) ?? 0;
  const detailQ = useQuery({
    queryKey: qk.adminUser(userId),
    queryFn: () => api.get<AdminUserDetail>(`/api/admin/users/${userId}`),
    enabled: Number.isInteger(userId) && userId > 0,
  });
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.adminUser(userId) });

  const revokeSession = async (sid: string) => {
    try {
      await api.del(`/api/admin/sessions/${sid}`);
      toast.success(t('userDetail.sessionRevoked'));
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('user.revokeFailed'));
    }
  };
  const revokeAll = async () => {
    try {
      const { revoked } = await api.del<{ revoked: number }>(`/api/users/${userId}/sessions`);
      toast.success(`${revoked} session(s) révoquée(s)`);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('user.revokeFailed'));
    }
  };
  const confirmDelete = async () => {
    try {
      await api.del(`/api/users/${userId}`);
      toast.success(t('userDetail.userDeleted'));
      qc.invalidateQueries({ queryKey: qk.users });
      navigate('/admin/users');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Suppression impossible');
    }
  };

  if (!detailQ.data) return <SkeletonRows count={6} />;
  const { user, memberships, sessions, apiTokens, activity, counts } = detailQ.data;

  return (
    <div className="space-y-6">
      <Link
        to="/admin/users"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={13} /> {t('admin.tab.users')}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar
            seed={user.id}
            initials={user.initials ?? '?'}
            avatarUrl={user.avatarUrl}
            size={48}
            online={user.online}
          />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{user.displayName ?? user.email}</h2>
              <Badge variant="secondary">{user.role}</Badge>
              {user.online && <Badge variant="secondary">{t('shell.online')}</Badge>}
              {user.twoFactorEnabled && (
                <Badge variant="secondary">
                  <ShieldCheck size={12} /> 2FA
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {user.email}
              {user.jobTitle ? ` · ${user.jobTitle}` : ''}
              {user.phone ? ` · ${user.phone}` : ''}
            </p>
            <p className="text-xs text-muted-foreground">
              Inscrit le {fmtDateTime(user.createdAt)}
              {user.lastSeenAt ? ` · dernière activité le ${fmtDateTime(user.lastSeenAt)}` : ''}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={14} /> {t('common.edit')}
          </Button>
          {user.id !== meId && (
            <Button variant="outline" size="sm" onClick={() => setDeleting(true)}>
              <Trash2 size={14} className="text-destructive" /> {t('common.delete')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Metric
          label={t('storage.title')}
          value={fmtBytes(user.storageUsed)}
          sub={user.storageLimit ? `quota ${fmtBytes(user.storageLimit)}` : t('common.noQuota')}
        />
        <Metric label={t('userDetail.uploadedMedia')} value={counts.media} />
        <Metric label={t('userDetail.createdVersions')} value={counts.versions} />
        <Metric label={t('admin.tab.comments')} value={counts.comments} />
        <Metric label={t('userDetail.assignedTasks')} value={counts.tasks} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MembershipsPanel memberships={memberships} />
        <SessionsPanel sessions={sessions} onRevoke={revokeSession} onRevokeAll={revokeAll} />
        <TokensPanel tokens={apiTokens} />
        <ActivityPanel activity={activity} />
      </div>

      {editing && (
        <UserModal
          title={t('user.edit')}
          user={user}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            invalidate();
            qc.invalidateQueries({ queryKey: qk.users });
          }}
        />
      )}
      <ConfirmDialog
        open={deleting}
        title={t('user.deleteQ')}
        message={<>« {user.displayName ?? user.email} » sera définitivement supprimé.</>}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(false)}
      />
    </div>
  );
}
