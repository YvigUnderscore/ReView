import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useAuth } from '../../stores/useAuth';
import ConfirmDialog from '../../components/ConfirmDialog';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { SkeletonRows } from '../../components/ui/skeleton';
import UserModal from './UserModal';
import { fmtBytes } from './adminShared';
import type { User } from '../../types/api';

export default function UsersTab() {
  const qc = useQueryClient();
  const meId = useAuth((s) => s.user?.id) ?? 0;
  const { data: users, isLoading } = useQuery({
    queryKey: qk.users,
    queryFn: () => api.get<{ users: User[] }>('/api/users').then((d) => d.users),
  });
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
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Comptes utilisateurs</h2>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Nouvel utilisateur
        </Button>
      </div>
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
            {(users ?? []).map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <span className="font-medium">{u.displayName ?? u.name ?? '—'}</span>
                  {u.online && (
                    <span className="ml-2 inline-block h-2 w-2 rounded-full bg-green-500" title="En ligne" />
                  )}
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
