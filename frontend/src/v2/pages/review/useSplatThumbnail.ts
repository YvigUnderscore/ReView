import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { MediaResp, SplatEditsPatch } from './reviewTypes';
import type { SplatViewer } from './splat/useSplat';

/**
 * Miniature splat (10.G) : pas de rendu headless serveur → capture client best-effort si
 * absente, réservée aux gestionnaires (le backend re-vérifie via assertMediaManage).
 * Renvoie aussi le callback post-enregistrement des éditions : patch du cache média
 * sans refetch + re-capture de la miniature (le rendu a changé).
 */
export function useSplatThumbnail(
  id: number,
  data: MediaResp | null,
  splat: SplatViewer,
  canManage: boolean,
): (patch: SplatEditsPatch) => void {
  const qc = useQueryClient();
  const thumbedRef = useRef(false);
  const { ready: splatReady, captureThumbnail } = splat;

  const uploadThumbnail = useCallback(async () => {
    const dataUrl = await captureThumbnail();
    if (!dataUrl) return;
    try {
      const { thumbnailUrl } = await api.post<{ thumbnailUrl: string }>(`/api/media/${id}/thumbnail`, {
        dataUrl,
      });
      qc.setQueryData<MediaResp>(qk.media(id), (old) => (old ? { ...old, thumbnailUrl } : old));
    } catch {
      // best-effort : miniature silencieuse (ex. droits insuffisants)
    }
  }, [captureThumbnail, id, qc]);

  useEffect(() => {
    if (data?.media.kind !== 'SPLAT' || !splatReady || data?.thumbnailUrl || !canManage || thumbedRef.current)
      return;
    thumbedRef.current = true;
    const t = setTimeout(() => void uploadThumbnail(), 600);
    return () => clearTimeout(t);
  }, [data, splatReady, canManage, uploadThumbnail]);

  return useCallback(
    (patch: SplatEditsPatch) => {
      qc.setQueryData<MediaResp>(qk.media(id), (old) => (old ? { ...old, ...patch } : old));
      // Après stabilisation du rendu — best-effort.
      setTimeout(() => void uploadThumbnail(), 400);
    },
    [qc, id, uploadThumbnail],
  );
}
