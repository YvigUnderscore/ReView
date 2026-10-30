// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { useT } from '../i18n';

/**
 * Visit acknowledgement, client side (Phase 50, batch 9).
 *
 * The glow computation belongs to the server: the client only says "I opened
 * it" and re-requests the lists. Nothing is inferred here: two people opening the same
 * shot only switch off their own card, and a glow computed client-side would
 * have lied again at the first change from elsewhere.
 */

/** The levels a card can light up: mirror of the enum accepted by the route. */
export type VisitTarget = 'PROJECT' | 'SEQUENCE' | 'SHOT' | 'ASSET' | 'TASK' | 'MEDIA';

/** The lists that carry a "mark all as read". */
export type VisitListTarget = 'SEQUENCE' | 'SHOT' | 'ASSET';

/**
 * Caches that carry an `unseen` flag, invalidated in one go as soon as a visit is acknowledged.
 *
 * Invalidation by **prefix** and not by exact key: a visited shot switches off in the
 * project's Shots tab, on its sequence page, and in another project's list open
 * in another browser tab. Enumerating exact keys would have required knowing here
 * the entity's project and sequence, which is one opportunity per screen to forget one,
 * and a card that stays lit just after it was closed.
 */
const GLOWING_LISTS: QueryKey[] = [['shots'], ['sequences'], ['sequence'], ['assets']];

/** Re-requests everything that displays a glow. */
async function refreshGlow(invalidate: (key: QueryKey) => Promise<void>) {
  await Promise.all(GLOWING_LISTS.map((key) => invalidate(key)));
}

/**
 * "I open this entity": switches off its glow, once, when its page mounts.
 *
 * `id` may arrive undefined or aberrant (URL parameter still resolving): nothing
 * is then sent. An acknowledgement that fails is **silent**: the glow will stay
 * lit, which is the worst that can happen, and it is not worth interrupting the
 * reading of a page with an error message about a secondary concern.
 */
export function useMarkVisited(target: VisitTarget, id: number | undefined, enabled = true) {
  const qc = useQueryClient();
  // A single acknowledgement per entity and per mount: the page re-renders on each
  // data load, and an unguarded effect would have posted every time.
  const acknowledged = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !id || !Number.isFinite(id) || id <= 0) return;
    const token = `${target}:${id}`;
    if (acknowledged.current === token) return;
    acknowledged.current = token;
    void (async () => {
      try {
        await api.post('/api/visits', { targetType: target, targetId: id });
      } catch {
        return;
      }
      await refreshGlow((key) => qc.invalidateQueries({ queryKey: key }));
    })();
  }, [target, id, enabled, qc]);
}

/**
 * "Mark all as read" for a project's list.
 *
 * The body carries only the type and the project: the server establishes the entities
 * concerned. Posting the list of displayed ids would have required checking
 * their membership one by one on the server, and would have left lit what a filter hid.
 */
export function useMarkAllSeen(target: VisitListTarget, projectId: number) {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: () => api.post<{ marked: number }>('/api/visits/mark-all', { targetType: target, projectId }),
    onSuccess: async ({ marked }) => {
      toast.success(t('cards.markAllSeenDone', { count: marked }));
      await refreshGlow((key) => qc.invalidateQueries({ queryKey: key }));
    },
    onError: () => toast.error(t('common.error.generic')),
  });
}
