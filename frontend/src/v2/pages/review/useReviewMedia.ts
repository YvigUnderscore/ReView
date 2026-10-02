// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { MediaResp } from './reviewTypes';
import { assemblingPollMs } from './videoPlayback';

/**
 * Le média de la page de review.
 *
 * staleTime Infinity : le GET régénère des URLs présignées à chaque appel — un refetch en
 * arrière-plan rechargerait le viewer en pleine lecture. Les mutations (publication,
 * reprocess) invalident explicitement. Seule exception, l'assemblage d'une séquence : il
 * n'y a alors rien à lire, donc rien à interrompre (cf. `assemblingPollMs`).
 */
export function useReviewMedia(id: number) {
  return useQuery({
    queryKey: qk.media(id),
    queryFn: () => api.get<MediaResp>(`/api/media/${id}`),
    staleTime: Infinity,
    refetchInterval: (query) => assemblingPollMs(query.state.data),
  });
}
