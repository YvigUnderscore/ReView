// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import { useUndoToast } from '../../lib/useUndoToast';
import type { TimelineSnapshotSummary, TimelineView } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Data and actions of an automatic montage (Phase 45).
 *
 * The montage is resolved on first access: no screen has to "create" it. Mutations are limited to
 * what a human decides — renaming, targeting a step, freezing a revision.
 *
 * **Undo.** The CUT itself is not assembled by hand: it is derived from the versions and the targeted
 * step, so there is no montage gesture to undo — no Ctrl+Z, no stack. Two settings remain, name and
 * targeted step, whose inverse is kept exactly: they are confirmed with "Undo". Changing the targeted
 * step rebuilds the whole cut, and nothing said so; it is the most impressive gesture on the screen
 * and the easiest to trigger by mistake.
 *
 * The frozen revision, on the other hand, cannot be undone: it is an audit record, no route deletes
 * it, and promising its removal would be a lie.
 */
/** The two settings a human sets on a montage. */
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

  /** The bare write: it lets its failure propagate, so that the undo can report it. */
  const write = async (id: number, body: TimelinePatch): Promise<void> => {
    await api.patch(`/api/timelines/${id}`, body);
    await refresh();
  };

  /** Writes a montage setting, and offers to restore the previous one. */
  const patch = async (body: TimelinePatch) => {
    if (!timeline) return;
    const id = timeline.id;
    // The previous state, restricted to the fields touched: sending both would freeze in the
    // montage a step it was merely inheriting from the "most advanced" default.
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
