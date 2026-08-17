// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useAuth } from '../../stores/useAuth';
import ConfirmDialog from '../../components/ConfirmDialog';
import Avatar from '../../components/Avatar';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { SkeletonRows } from '../../components/ui/skeleton';
import { initialsFrom } from '../../lib/initials';
import UserModal from './UserModal';
import { fmtBytes, ROLES } from './adminShared';
import { filterUsers, sortUsers, type UserSort } from './adminUsers';
import type { Role, User } from '../../types/api';
import { useT } from '../../i18n';

/** Liste des comptes (refonte admin) : recherche, filtre par rôle, tri, fiche détaillée. */
export default function UsersTab() {
  const t = useT();
  const qc = useQueryClient();
  const meId = useAuth((s) => s.user?.id) ?? 0;
  const { data: users, isLoading } = useQuery({
    queryKey: qk.users,
    queryFn: () => api.get<{ users: User[] }>('/api/users').then((d) => d.users),
  });
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | 'ALL'>('ALL');
  const [sort, setSort] = useState<UserSort>('name');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [resending, setResending] = useState<number | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.users });
  /** Relance : le lien précédent est périmé côté serveur, un seul lien vit à la fois. */
  const resendInvite = async (u: User) => {
    setResending(u.id);
    try {
      await api.post(`/api/users/${u.id}/invite`);
      toast.success(t('users.inviteResent', { email: u.email }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    } finally {
      setResending(null);
    }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/users/${deleting.id}`);
      toast.success(t('userDetail.userDeleted'));
      setDeleting(null);
      void invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.delete'));
    }
  };

  if (isLoading) return <SkeletonRows count={5} />;
  const shown = sortUsers(filterUsers(users ?? [], q, role), sort);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('users.searchPlaceholder')}
            className="pl-8"
          />
        </div>
        <Select value={role} onChange={(e) => setRole(e.target.value as Role | 'ALL')}>
          <option value="ALL">{t('users.allRoles')}</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as UserSort)}>
          <option value="name">{t('users.sortName')}</option>
          <option value="role">{t('users.sortRole')}</option>
          <option value="storage">{t('users.sortStorage')}</option>
          <option value="recent">{t('users.sortRecent')}</option>
        </Select>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> {t('users.new')}
        </Button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{t('users.total', { count: shown.length })}</p>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">{t('common.user')}</th>
              <th className="px-3 py-2">{t('login.email')}</th>
              <th className="px-3 py-2">{t('common.role')}</th>
              <th className="px-3 py-2">{t('storage.title')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className="border-t border-border hover:bg-secondary/40">
                <td className="px-3 py-2">
                  <Link to={`/admin/users/${u.id}`} className="flex items-center gap-2">
                    <Avatar
                      seed={u.id}
                      initials={u.initials ?? initialsFrom(u.displayName ?? u.name)}
                      avatarUrl={u.avatarUrl}
                      size={28}
                      online={u.online}
                    />
                    <span className="font-medium hover:underline">{u.displayName ?? u.name ?? '—'}</span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    {u.email}
                    {u.invitePending && (
                      <Badge variant="warning" title={t('users.invitePendingHint')}>
                        {t('users.invitePending')}
                      </Badge>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Badge variant="secondary">{u.role}</Badge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {fmtBytes(u.storageUsed)}
                  {u.storageLimit ? ` / ${fmtBytes(u.storageLimit)}` : ''}
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    {u.invitePending && (
                      <button
                        onClick={() => void resendInvite(u)}
                        disabled={resending === u.id}
                        title={t('users.resendInvite')}
                        className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
                      >
                        <Send size={15} />
                      </button>
                    )}
                    <button
                      onClick={() => setEditing(u)}
                      title={t('common.edit')}
                      className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <Pencil size={15} />
                    </button>
                    {u.id !== meId && (
                      <button
                        onClick={() => setDeleting(u)}
                        title={t('common.delete')}
                        className="rounded p-1.5 text-destructive hover:bg-secondary"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {t('users.noMatch')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <UserModal
          title={t('users.new')}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void invalidate();
          }}
        />
      )}
      {editing && (
        <UserModal
          title={t('user.edit')}
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void invalidate();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={t('user.deleteQ')}
        message={t('user.delete.message', { name: deleting?.displayName ?? deleting?.email ?? '' })}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
