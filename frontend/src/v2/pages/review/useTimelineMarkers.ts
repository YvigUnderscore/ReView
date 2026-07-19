import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { getSocket } from '../../../lib/socket';
import { qk } from '../../lib/query';
import { useAuth } from '../../stores/useAuth';
import type { TimelineMarker } from '../../types/api';

/**
 * Marqueurs de timeline nommés/colorés partagés (34.C) : query + mutations + invalidation
 * temps réel (`markers:changed` sur la room de review, jointe par la présence). Création
 * par les rôles d'écriture ; gestion (renommer/recolorer/supprimer) par l'auteur ou un
 * superviseur — le serveur fait foi, l'UI ne fait que masquer les actions.
 */
export interface TimelineMarkersApi {
  markers: TimelineMarker[];
  canWrite: boolean;
  canManage: (m: TimelineMarker) => boolean;
  add: (frame: number, name: string, color: string) => Promise<void>;
  rename: (m: TimelineMarker, name: string, color: string) => Promise<void>;
  remove: (m: TimelineMarker) => Promise<void>;
}

export function useTimelineMarkers(mediaId: number): TimelineMarkersApi {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id) ?? 0;
  const role = useAuth((s) => s.user?.role);
  const canWrite = role === 'ADMIN' || role === 'SUPERVISOR' || role === 'ARTIST';

  const markersQ = useQuery({
    queryKey: qk.timelineMarkers(mediaId),
    queryFn: () =>
      api.get<{ markers: TimelineMarker[] }>(`/api/media/${mediaId}/markers`).then((d) => d.markers),
    enabled: mediaId > 0,
  });

  useEffect(() => {
    const socket = getSocket();
    const onChanged = (data: { mediaId: number }) => {
      if (data.mediaId === mediaId) void qc.invalidateQueries({ queryKey: qk.timelineMarkers(mediaId) });
    };
    socket.on('markers:changed', onChanged);
    return () => {
      socket.off('markers:changed', onChanged);
    };
  }, [mediaId, qc]);

  const refresh = () => qc.invalidateQueries({ queryKey: qk.timelineMarkers(mediaId) });
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      await refresh();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur sur le marqueur');
    }
  };

  return {
    markers: markersQ.data ?? [],
    canWrite,
    canManage: (m) => role === 'ADMIN' || role === 'SUPERVISOR' || m.authorId === userId,
    add: (frame, name, color) =>
      run(() => api.post(`/api/media/${mediaId}/markers`, { frame, name, color }), 'Marqueur ajouté'),
    rename: (m, name, color) =>
      run(() => api.patch(`/api/media/${mediaId}/markers/${m.id}`, { name, color }), 'Marqueur modifié'),
    remove: (m) => run(() => api.del(`/api/media/${mediaId}/markers/${m.id}`), 'Marqueur supprimé'),
  };
}
