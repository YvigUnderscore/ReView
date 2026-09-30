// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { MediaResp, SplatEditsPatch } from './reviewTypes';
import type { SplatViewer } from './splat/useSplat';

/**
 * Callback post-enregistrement des éditions splat (10.G) : patch du cache média sans refetch,
 * puis **re-capture** de la miniature (le rendu a changé) via `/thumbnail` — réservé aux
 * gestionnaires d'un média non publié (le backend re-vérifie `assertMediaManage` + verrou).
 * Le bootstrap de miniature à la 1re vue est géré par `useAutoThumbnail` (tous les viewers).
 */
export function useSplatThumbnail(
  id: number,
  splat: SplatViewer,
  canEdit: boolean,
): (patch: SplatEditsPatch) => void {
  const qc = useQueryClient();
  const { captureThumbnail } = splat;

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

  return useCallback(
    (patch: SplatEditsPatch) => {
      qc.setQueryData<MediaResp>(qk.media(id), (old) => (old ? { ...old, ...patch } : old));
      // Après stabilisation du rendu — best-effort, uniquement si l'utilisateur peut éditer.
      if (canEdit) setTimeout(() => void uploadThumbnail(), 400);
    },
    [qc, id, uploadThumbnail, canEdit],
  );
}
