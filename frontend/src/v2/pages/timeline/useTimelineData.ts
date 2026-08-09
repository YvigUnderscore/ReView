// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { TimelineSnapshotSummary, TimelineView } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Données et actions d'un montage automatique (Phase 45).
 *
 * Le montage est résolu au premier accès : aucun écran n'a à le « créer ». Les mutations
 * se limitent à ce qu'un humain décide — renommer, viser une étape, figer une révision.
 */
export function useTimelineData(projectId: number, sequenceId: number | null, enabled = true) {
  const t = useT();
  const qc = useQueryClient();

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

  const patch = async (body: { name?: string | null; department?: string | null }) => {
    if (!timeline) return;
    try {
      await api.patch(`/api/timelines/${timeline.id}`, body);
      await refresh();
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
