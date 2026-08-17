// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { useT } from '../i18n';

/** Cible d'un suivi de notifications (32.G). */
export type WatchTargetType = 'SHOT' | 'ASSET' | 'VERSION';

interface WatchRef {
  targetType: WatchTargetType;
  targetId: number;
}

/**
 * Suivis de l'utilisateur (32.G) : état groupé (une seule requête pour tous les
 * menus clic droit) + bascule suivre/ne plus suivre avec toast.
 */
export function useWatch() {
  const t = useT();
  const qc = useQueryClient();
  const watchesQ = useQuery({
    queryKey: qk.watches,
    queryFn: () => api.get<{ watches: WatchRef[] }>('/api/watch').then((d) => d.watches),
    staleTime: 60_000,
  });
  const keys = new Set((watchesQ.data ?? []).map((w) => `${w.targetType}:${w.targetId}`));
  const isWatching = (targetType: WatchTargetType, targetId: number) => keys.has(`${targetType}:${targetId}`);

  const mutation = useMutation({
    mutationFn: (v: WatchRef & { watching: boolean }) => api.put('/api/watch', v),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: qk.watches });
      toast.success(v.watching ? t('watch.on') : t('watch.off'));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t('watch.failed')),
  });

  const toggle = (targetType: WatchTargetType, targetId: number) =>
    mutation.mutate({ targetType, targetId, watching: !isWatching(targetType, targetId) });

  return { isWatching, toggle };
}
