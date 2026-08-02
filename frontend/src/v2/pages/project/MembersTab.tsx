// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { DeleteIcon } from '../../components/EntityCard';
import Avatar from '../../components/Avatar';
import { initialsFrom } from '../../lib/initials';
import type { Member } from './projectTypes';
import type { Role } from '../../types/api';

// Rôle projet : override facultatif du rôle global (38.E). '' = hérite du rôle global.
const PROJECT_ROLES: { value: string; label: string }[] = [
  { value: '', label: 'Rôle global' },
  { value: 'SUPERVISOR', label: 'Superviseur (projet)' },
  { value: 'ARTIST', label: 'Artiste' },
  { value: 'CLIENT', label: 'Client (lecture/commentaire)' },
];

/** Onglet Membres : ajout/retrait des utilisateurs du projet + rôle par projet (38.E). */
export default function MembersTab({ projectId }: { projectId: number }) {
  const qc = useQueryClient();
  const projQ = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.get<{ project: { memberships: Member[] } }>(`/api/projects/${projectId}`),
  });
  const usersQ = useQuery({
    queryKey: qk.users,
    queryFn: () =>
      api
        .get<{ users: { id: number; name: string | null; email: string }[] }>('/api/users')
        .then((d) => d.users),
  });
  const members = projQ.data?.project.memberships ?? [];
  const allUsers = usersQ.data ?? [];
  const loadError = (projQ.error ?? usersQ.error)?.message ?? null;
  const [addUserId, setAddUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.project(projectId) });

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addUserId) return;
    try {
      await api.post(`/api/projects/${projectId}/members`, { userId: Number(addUserId) });
      toast.success('Membre ajouté au projet');
      setAddUserId('');
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };
  const setRole = async (userId: number, role: string) => {
    try {
      await api.post(`/api/projects/${projectId}/members`, {
        userId,
        role: role ? (role as Role) : undefined,
      });
      toast.success('Rôle du membre mis à jour');
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };
  const remove = async (userId: number) => {
    try {
      await api.del(`/api/projects/${projectId}/members/${userId}`);
      toast.success('Membre retiré du projet');
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const memberIds = new Set(members.map((m) => m.user.id));
  const available = allUsers.filter((u) => !memberIds.has(u.id));

  return (
    <div>
      <h2 className="mb-4 text-sm font-semibold text-muted-foreground">Membres du projet</h2>
      {(error ?? loadError) && <p className="mb-3 text-sm text-destructive">{error ?? loadError}</p>}
      <form onSubmit={add} className="mb-5 flex gap-2 rounded-md border border-border bg-card p-2">
        <select
          className="flex-1 rounded border border-input bg-background px-2 py-1.5 text-sm"
          value={addUserId}
          onChange={(e) => setAddUserId(e.target.value)}
        >
          <option value="">Ajouter un utilisateur…</option>
          {available.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.email} ({u.email})
            </option>
          ))}
        </select>
        <button className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground">
          <Plus size={14} /> Ajouter
        </button>
      </form>
      <div className="space-y-1.5">
        {members.map((m) => (
          <div
            key={m.user.id}
            className="group flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <Avatar seed={m.user.id} initials={initialsFrom(m.user.name)} size={28} />
              <div>
                <span className="text-sm font-medium">{m.user.name ?? m.user.email}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {m.user.email} · {m.user.role}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="rounded border border-input bg-background px-2 py-1 text-xs"
                value={m.role ?? ''}
                onChange={(e) => setRole(m.user.id, e.target.value)}
                title="Rôle sur ce projet"
              >
                {PROJECT_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => remove(m.user.id)}
                title="Retirer"
                className="flex h-7 w-7 items-center justify-center rounded-md text-destructive opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100"
              >
                {DeleteIcon}
              </button>
            </div>
          </div>
        ))}
        {members.length === 0 && <p className="text-sm text-muted-foreground">Aucun membre assigné.</p>}
      </div>
    </div>
  );
}
