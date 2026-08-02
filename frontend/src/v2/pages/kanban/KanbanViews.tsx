// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Select } from '../../components/ui/select';
import { Input } from '../../components/ui/input';
import { removeView, upsertView, type KanbanFilterState, type KanbanViewsPref } from './kanbanTypes';
import { useT } from '../../i18n';

/**
 * Vues kanban sauvegardées (backlog P2 10.G) : filtres nommés persistés par
 * utilisateur et par projet dans `preferences.kanbanViews` (backend).
 */
export default function KanbanViews({
  projectId,
  filter,
  onApply,
}: {
  projectId: number;
  filter: KanbanFilterState;
  onApply: (f: KanbanFilterState) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [selected, setSelected] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const prefsQ = useQuery({
    queryKey: qk.preferences,
    queryFn: () =>
      api
        .get<{ preferences: { kanbanViews?: KanbanViewsPref } }>('/api/users/me/preferences')
        .then((d) => d.preferences),
  });
  const allViews = prefsQ.data?.kanbanViews ?? {};
  const views = allViews[String(projectId)] ?? [];

  const mutation = useMutation({
    mutationFn: (next: KanbanViewsPref) => api.patch('/api/users/me/preferences', { kanbanViews: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.preferences }),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Erreur d’enregistrement de la vue'),
  });

  const saveCurrent = () => {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    mutation.mutate(upsertView(allViews, projectId, { name: trimmed, filter }), {
      onSuccess: () => {
        toast.success(`Vue « ${trimmed} » enregistrée`);
        setSelected(trimmed);
        setNaming(false);
        setName('');
      },
    });
  };

  const apply = (n: string) => {
    setSelected(n);
    const v = views.find((x) => x.name === n);
    if (v) onApply(v.filter);
  };

  const remove = () => {
    const n = selected;
    mutation.mutate(removeView(allViews, projectId, n), {
      onSuccess: () => {
        toast.success(`Vue « ${n} » supprimée`);
        setSelected('');
      },
    });
  };

  return (
    <div className="flex items-center gap-2">
      {views.length > 0 && (
        <Select value={selected} onChange={(e) => apply(e.target.value)} className="py-1.5">
          <option value="">Vues…</option>
          {views.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name}
            </option>
          ))}
        </Select>
      )}
      {selected !== '' && (
        <button
          onClick={remove}
          title={`Supprimer la vue « ${selected} »`}
          className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Trash2 size={14} />
        </button>
      )}
      {naming ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveCurrent();
          }}
          className="flex items-center gap-1.5"
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNaming(false)}
            placeholder={t('savedViews.name')}
            className="h-8 w-40"
          />
          <button
            type="submit"
            disabled={!name.trim() || mutation.isPending}
            className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            OK
          </button>
        </form>
      ) : (
        <button
          onClick={() => setNaming(true)}
          title={t('savedViews.saveCurrent')}
          className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <BookmarkPlus size={14} />
          Enregistrer la vue
        </button>
      )}
    </div>
  );
}
