import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
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

/** Liste des comptes (refonte admin) : recherche, filtre par rôle, tri, fiche détaillée. */
export default function UsersTab() {
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

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.users });
  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.del(`/api/users/${deleting.id}`);
      toast.success('Utilisateur supprimé');
      setDeleting(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Suppression impossible');
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
            placeholder="Rechercher (nom, pseudo, email)…"
            className="pl-8"
          />
        </div>
        <Select value={role} onChange={(e) => setRole(e.target.value as Role | 'ALL')}>
          <option value="ALL">Tous les rôles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as UserSort)}>
          <option value="name">Tri : nom</option>
          <option value="role">Tri : rôle</option>
          <option value="storage">Tri : stockage</option>
          <option value="recent">Tri : plus récents</option>
        </Select>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Nouvel utilisateur
        </Button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        {shown.length} compte(s) — cliquer sur un nom ouvre la fiche détaillée (projets, sessions, activité).
      </p>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-card text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Utilisateur</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Rôle</th>
              <th className="px-3 py-2">Stockage</th>
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
                <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                <td className="px-3 py-2">
                  <Badge variant="secondary">{u.role}</Badge>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {fmtBytes(u.storageUsed)}
                  {u.storageLimit ? ` / ${fmtBytes(u.storageLimit)}` : ''}
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => setEditing(u)}
                      title="Modifier"
                      className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <Pencil size={15} />
                    </button>
                    {u.id !== meId && (
                      <button
                        onClick={() => setDeleting(u)}
                        title="Supprimer"
                        className="rounded p-1 text-destructive hover:bg-secondary"
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
                  Aucun compte ne correspond aux filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <UserModal
          title="Nouvel utilisateur"
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}
      {editing && (
        <UserModal
          title="Modifier l'utilisateur"
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Supprimer l'utilisateur ?"
        message={<>« {deleting?.displayName ?? deleting?.email} » sera définitivement supprimé.</>}
        confirmLabel="Supprimer"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
