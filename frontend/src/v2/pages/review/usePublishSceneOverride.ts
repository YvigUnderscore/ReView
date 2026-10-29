// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import type { MediaResp } from './reviewTypes';
import { isEmptyOverride, mergeOverrides, normalizeOverride } from './three/sceneOverride';
import { useT } from '../../i18n';

/**
 * Publishing freezes the scene (Phase 11 lock): the manager's **unsaved** 3D staging becomes the base
 * override first (46.S) — what they see at the moment of publishing is what reviewers will see by
 * default, without going through "Save for everyone".
 *
 * Returns a callback for `useMediaActions`: `false` cancels the publication — publishing without the
 * intended staging would lose it for good, the override being frozen afterwards.
 */
export function usePublishSceneOverride(
  id: number,
  data: MediaResp | null | undefined,
  ann: { sceneOverride: unknown; setSceneOverride: (value: unknown) => void },
): () => Promise<boolean> {
  const t = useT();
  const qc = useQueryClient();
  const { sceneOverride, setSceneOverride } = ann;

  return async () => {
    const pending = normalizeOverride(sceneOverride);
    if (data?.media.kind !== 'MODEL_3D' || isEmptyOverride(pending)) return true;
    try {
      const merged = mergeOverrides(normalizeOverride(data.usdOverride), pending);
      await api.put(`/api/media/${id}/usd/override`, { override: merged });
      // Targeted cache, no refetch: the presigned URLs would change and reload the viewer in the middle
      // of the publication.
      qc.setQueryData<MediaResp>(qk.media(id), (old) => (old ? { ...old, usdOverride: merged } : old));
      setSceneOverride(null);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('stage.notSavedPublishCancelled'));
      return false;
    }
  };
}
