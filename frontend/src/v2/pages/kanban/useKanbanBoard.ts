// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQueries, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useAssetsQuery, useSequencesQuery, useShotsQuery } from '../../lib/queries';
import type { TaskStatus, TaskWithAssignee } from '../../types/api';
import type { BoardTask } from './kanbanTypes';
import { useT } from '../../i18n';

/**
 * Données du board kanban : shots + séquences + tâches (fan-out par shot),
 * et déplacement d'une carte (changement de statut) en update optimiste avec
 * rollback par invalidation. Une clé = une shape (cohérent 10.E1).
 */
export function useKanbanBoard(projectId: number) {
  const tr = useT();
  const qc = useQueryClient();
  const shotsQ = useShotsQuery(projectId);
  const sequencesQ = useSequencesQuery(projectId);
  const assetsQ = useAssetsQuery(projectId);
  const shots = shotsQ.data ?? [];
  const assets = assetsQ.data ?? [];

  // Une tâche pend d'un shot ou d'un asset : parcourir les deux, sans quoi un projet
  // dont le travail vit sur les assets affiche un board vide.
  const parents = [
    ...shots.map((s) => ({
      kind: 'shot' as const,
      id: s.id,
      label: s.code,
      sequenceId: s.sequenceId ?? null,
    })),
    ...assets.map((a) => ({ kind: 'asset' as const, id: a.id, label: a.name, sequenceId: null })),
  ];

  const taskQueries = useQueries({
    queries: parents.map((p) => ({
      queryKey: p.kind === 'shot' ? qk.tasks(p.id) : ['tasks', 'asset', p.id],
      queryFn: () =>
        api
          .get<{ items: TaskWithAssignee[] }>(
            p.kind === 'shot' ? `/api/tasks?shotId=${p.id}` : `/api/tasks?assetId=${p.id}`,
          )
          .then((d) => d.items),
    })),
  });

  const tasks: BoardTask[] = parents.flatMap((p, i) =>
    (taskQueries[i]?.data ?? []).map((t) => ({
      ...t,
      shotId: p.kind === 'shot' ? p.id : null,
      assetId: p.kind === 'asset' ? p.id : null,
      parentLabel: p.label,
      parentKind: p.kind,
      sequenceId: p.sequenceId,
    })),
  );

  const isLoading = shotsQ.isLoading || assetsQ.isLoading || taskQueries.some((q) => q.isLoading);
  const loadError =
    (shotsQ.error ?? assetsQ.error ?? taskQueries.find((q) => q.error)?.error)?.message ?? null;

  // Déplacement optimiste dans le cache du parent concerné ; rollback par invalidation.
  const move = async (taskId: number, status: TaskStatus) => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t || t.status === status) return;
    const key = t.shotId !== null ? qk.tasks(t.shotId) : ['tasks', 'asset', t.assetId!];
    qc.setQueryData<TaskWithAssignee[]>(key, (old) =>
      old?.map((x) => (x.id === taskId ? { ...x, status } : x)),
    );
    try {
      await api.patch(`/api/tasks/${taskId}`, { status });
    } catch (e) {
      qc.invalidateQueries({ queryKey: key });
      toast.error(e instanceof Error ? e.message : tr('kanban.moveFailed'));
    }
  };

  return { shots, sequences: sequencesQ.data?.sequences ?? [], tasks, isLoading, loadError, move };
}
