import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { DeleteIcon } from '../../components/EntityCard';
import type { Member } from './projectTypes';

/** Onglet Membres : ajout/retrait des utilisateurs du projet. */
export default function MembersTab({ projectId }: { projectId: number }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [allUsers, setAllUsers] = useState<{ id: number; name: string | null; email: string }[]>([]);
  const [addUserId, setAddUserId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ project }, { users }] = await Promise.all([
      api.get<{ project: { memberships: Member[] } }>(`/api/projects/${projectId}`),
      api.get<{ users: { id: number; name: string | null; email: string }[] }>('/api/users'),
    ]);
    setMembers(project.memberships); setAllUsers(users);
  }, [projectId]);
  useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : 'Erreur')); }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addUserId) return;
    try {
      await api.post(`/api/projects/${projectId}/members`, { userId: Number(addUserId) });
      toast.success('Membre ajouté au projet');
      setAddUserId(''); load();
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };
  const remove = async (userId: number) => {
    try {
      await api.del(`/api/projects/${projectId}/members/${userId}`);
      toast.success('Membre retiré du projet');
      load();
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
  };

  const memberIds = new Set(members.map((m) => m.user.id));
  const available = allUsers.filter((u) => !memberIds.has(u.id));

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-muted-foreground">Membres du projet</h2>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      <form onSubmit={add} className="mb-5 flex gap-2 rounded-md border border-border bg-card p-2">
        <select className="flex-1 rounded border border-input bg-background px-2 py-1.5 text-sm" value={addUserId} onChange={(e) => setAddUserId(e.target.value)}>
          <option value="">Ajouter un utilisateur…</option>
          {available.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email} ({u.email})</option>)}
        </select>
        <button className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"><Plus size={14} /> Ajouter</button>
      </form>
      <div className="space-y-1.5">
        {members.map((m) => (
          <div key={m.user.id} className="group flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
            <div>
              <span className="text-sm font-medium">{m.user.name ?? m.user.email}</span>
              <span className="ml-2 text-xs text-muted-foreground">{m.user.email} · {m.user.role}</span>
            </div>
            <button onClick={() => remove(m.user.id)} title="Retirer" className="flex h-7 w-7 items-center justify-center rounded-md text-destructive opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100">
              {DeleteIcon}
            </button>
          </div>
        ))}
        {members.length === 0 && <p className="text-sm text-muted-foreground">Aucun membre assigné.</p>}
      </div>
    </div>
  );
}
