// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import type { CommentAttachment } from '../../lib/commentAttachments';
import { qk } from './query';
import type { CommentState } from '../components/comments/commentState';
import { useT } from '../i18n';

/**
 * Comment mutations (D1).
 *
 * They were hand-written, each with an empty `catch {}`: resolving a thread without the right to,
 * or with the network down, produced nothing at all — no error, no change, the impression that the
 * button does not work. Going through TanStack Query makes the failure visible and the invalidation consistent.
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

/**
 * Editing a comment. `attachments` is the COMPLETE list after editing (D5): omitted, the server
 * leaves it alone; provided, it replaces — and whatever is removed leaves the storage. The `PATCH`
 * used to ignore it, so an image could be neither added nor removed.
 */
export function useEditComment(mediaObjectId: number) {
  return useCommentMutation<{ id: number; content: string; attachments?: CommentAttachment[] }>(
    mediaObjectId,
    ({ id, content, attachments }) => api.patch(`/api/comments/${id}`, { content, attachments }),
  );
}

export function useDeleteComment(mediaObjectId: number) {
  return useCommentMutation<number>(mediaObjectId, (id) => api.del(`/api/comments/${id}`));
}

/**
 * Client visibility and assignment: accepted by the API since phase 32 and driven by
 * nothing — no screen sent them. Reserved for managers, server-side too.
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
