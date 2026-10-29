// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { MediaResp } from './reviewTypes';
import { assemblingPollMs } from './videoPlayback';

/**
 * The review page's media.
 *
 * staleTime Infinity: the GET regenerates presigned URLs on every call — a background refetch would
 * reload the viewer in the middle of playback. Mutations (publication, reprocess) invalidate
 * explicitly. The only exception is the assembly of a sequence: there is then nothing to read, hence
 * nothing to interrupt (see `assemblingPollMs`).
 */
export function useReviewMedia(id: number) {
  return useQuery({
    queryKey: qk.media(id),
    queryFn: () => api.get<MediaResp>(`/api/media/${id}`),
    staleTime: Infinity,
    refetchInterval: (query) => assemblingPollMs(query.state.data),
  });
}
