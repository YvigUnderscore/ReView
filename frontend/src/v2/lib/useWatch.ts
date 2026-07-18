import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from './query';

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
      qc.invalidateQueries({ queryKey: qk.watches });
      toast.success(v.watching ? 'Suivi activé : vous serez notifié de l’activité' : 'Suivi désactivé');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Impossible de modifier le suivi'),
  });

  const toggle = (targetType: WatchTargetType, targetId: number) =>
    mutation.mutate({ targetType, targetId, watching: !isWatching(targetType, targetId) });

  return { isWatching, toggle };
}
