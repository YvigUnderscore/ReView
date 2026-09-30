// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useUndoToast } from '../../lib/useUndoToast';
import type { TimelineSnapshotSummary, TimelineView } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Données et actions d'un montage automatique (Phase 45).
 *
 * Le montage est résolu au premier accès : aucun écran n'a à le « créer ». Les mutations
 * se limitent à ce qu'un humain décide — renommer, viser une étape, figer une révision.
 *
 * **Annulation.** Le CUT lui-même n'est pas monté à la main : il se déduit des versions et de
 * l'étape visée, il n'y a donc aucun geste de montage à défaire — ni Ctrl+Z, ni pile. Restent
 * deux réglages, nom et étape visée, dont l'inverse est tenu exactement : ils se confirment avec
 * « Annuler ». Changer l'étape visée rebâtit le cut entier, et rien ne le disait ; c'est le
 * geste le plus impressionnant de l'écran et le plus facile à déclencher par erreur.
 *
 * La révision figée, elle, ne s'annule pas : c'est une pièce d'audit, aucune route ne la
 * supprime, et en promettre le retrait serait mentir.
 */
/** Les deux réglages qu'un humain pose sur un montage. */
type TimelinePatch = { name?: string | null; department?: string | null };

export function useTimelineData(projectId: number, sequenceId: number | null, enabled = true) {
  const t = useT();
  const qc = useQueryClient();
  const { done } = useUndoToast();

  const timelineQ = useQuery({
    queryKey: qk.timelineOf(projectId, sequenceId),
    queryFn: () =>
      api
        .get<{ timeline: TimelineView }>(
          `/api/timelines?projectId=${projectId}${sequenceId !== null ? `&sequenceId=${sequenceId}` : ''}`,
        )
        .then((d) => d.timeline),
    enabled: enabled && projectId > 0,
  });
  const timeline = timelineQ.data ?? null;

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['timeline'] });
  };

  /** L'écriture nue : elle laisse remonter son échec, pour que l'annulation puisse le dire. */
  const write = async (id: number, body: TimelinePatch): Promise<void> => {
    await api.patch(`/api/timelines/${id}`, body);
    await refresh();
  };

  /** Écrit un réglage du montage, et propose de remettre celui d'avant. */
  const patch = async (body: TimelinePatch) => {
    if (!timeline) return;
    const id = timeline.id;
    // L'état d'avant, restreint aux champs touchés : réenvoyer les deux figerait dans le
    // montage une étape qu'il ne faisait qu'hériter du défaut « la plus avancée ».
    const previous: TimelinePatch = {
      ...('name' in body ? { name: timeline.name } : {}),
      ...('department' in body ? { department: timeline.department } : {}),
    };
    try {
      await write(id, body);
      done(t('timeline.updated'), () => write(id, previous));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    }
  };

  const snapshot = async () => {
    if (!timeline) return;
    try {
      const { snapshot: created } = await api.post<{ snapshot: TimelineSnapshotSummary }>(
        `/api/timelines/${timeline.id}/snapshots`,
        {},
      );
      toast.success(t('timeline.snapshotTaken', { revision: created.revision }));
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    }
  };

  return {
    timeline,
    isLoading: timelineQ.isLoading,
    error: timelineQ.error?.message ?? null,
    rename: (name: string | null) => patch({ name }),
    setDepartment: (department: string | null) => patch({ department }),
    snapshot,
  };
}
