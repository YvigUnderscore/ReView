// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import type { MediaResp, SplatEditsPatch } from './reviewTypes';
import type { SplatViewer } from './splat/useSplat';

/**
 * Post-save callback for splat edits (10.G): patches the media cache without refetch, then
 * **re-captures** the thumbnail (the render has changed) via `/thumbnail` — reserved for managers of an
 * unpublished media (the backend re-checks `assertMediaManage` + lock). First-view thumbnail bootstrap
 * is handled by `useAutoThumbnail` (all viewers).
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
      // best-effort: silent thumbnail (e.g. insufficient rights)
    }
  }, [captureThumbnail, id, qc]);

  return useCallback(
    (patch: SplatEditsPatch) => {
      qc.setQueryData<MediaResp>(qk.media(id), (old) => (old ? { ...old, ...patch } : old));
      // After the render has stabilized — best-effort, only if the user can edit.
      if (canEdit) setTimeout(() => void uploadThumbnail(), 400);
    },
    [qc, id, uploadThumbnail, canEdit],
  );
}
