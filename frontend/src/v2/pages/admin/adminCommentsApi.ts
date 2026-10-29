// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { qk } from '@/v2/lib/query';
import type { AdminCommentRow, Paginated } from '@/v2/types/api';

/** Every admin comment list, whatever its filter: what a moderation action invalidates. */
export const adminCommentsAllKey = ['admin', 'comments'] as const;

/** One page of the studio's comments; `filter` is the query string (page, filters, search). */
export function useAdminCommentsQuery(filter: string) {
  return useQuery({
    queryKey: qk.adminComments(filter),
    queryFn: () => api.get<Paginated<AdminCommentRow>>(`/api/admin/comments?${filter}`),
  });
}

export const adminCommentsApi = {
  setResolved: (id: number, isResolved: boolean) => api.patch(`/api/comments/${id}`, { isResolved }),
  remove: (id: number) => api.del(`/api/comments/${id}`),
};
