// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import type { CommentState } from '../components/comments/commentState';
import { useT } from '../i18n';

/**
 * Mutations de commentaire (D1).
 *
 * Elles étaient écrites à la main, chacune avec un `catch {}` vide : résoudre un fil sans
 * en avoir le droit, ou avec le réseau coupé, ne produisait rien du tout — pas d'erreur,
 * pas de changement, l'impression que le bouton ne marche pas. Passer par TanStack Query
 * rend l'échec visible et l'invalidation cohérente.
 */

function useCommentMutation<T>(mediaObjectId: number, fn: (input: T) => Promise<unknown>) {
  const t = useT();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.comments(mediaObjectId) }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : t('common.error.generic')),
  });
}

export function useSetCommentState(mediaObjectId: number) {
  return useCommentMutation<{ id: number; state: CommentState }>(mediaObjectId, ({ id, state }) =>
    api.patch(`/api/comments/${id}`, { state }),
  );
}

export function useEditComment(mediaObjectId: number) {
  return useCommentMutation<{ id: number; content: string }>(mediaObjectId, ({ id, content }) =>
    api.patch(`/api/comments/${id}`, { content }),
  );
}

export function useDeleteComment(mediaObjectId: number) {
  return useCommentMutation<number>(mediaObjectId, (id) => api.del(`/api/comments/${id}`));
}

/**
 * Visibilité client et assignation : acceptées par l'API depuis la phase 32 et pilotées
 * par rien — aucun écran ne les envoyait. Réservées aux gestionnaires, côté serveur aussi.
 */
export function useSetCommentVisibility(mediaObjectId: number) {
  return useCommentMutation<{ id: number; isVisibleToClient: boolean }>(
    mediaObjectId,
    ({ id, isVisibleToClient }) => api.patch(`/api/comments/${id}`, { isVisibleToClient }),
  );
}

export function useAssignComment(mediaObjectId: number) {
  return useCommentMutation<{ id: number; assigneeId: number | null }>(mediaObjectId, ({ id, assigneeId }) =>
    api.patch(`/api/comments/${id}`, { assigneeId }),
  );
}
