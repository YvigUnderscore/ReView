// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../lib/apiClient';
import type { SplatEditsPatch, SplatPresentation } from '../reviewTypes';
import { useT } from '../../../i18n';

/**
 * Persistence of the camera presentation (Phase 17), shared by 3D/splat: PATCH
 * `/api/media/:id/splat-presentation`, cache update (`onSaved`), toasts and `busy` state.
 * Both viewers build their `SplatPresentation` object (the splat adds dof/reveal/lod) and then
 * call `persist` — a single network path, no more duplication.
 */
export function useCameraPresentation(mediaId: number, onSaved: (patch: SplatEditsPatch) => void) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const persist = useCallback(
    async (presentation: SplatPresentation) => {
      setBusy(true);
      try {
        const { splatPresentation } = await api.patch<{ splatPresentation: SplatPresentation | null }>(
          `/api/media/${mediaId}/splat-presentation`,
          { presentation },
        );
        onSaved({ splatPresentation });
        toast.success(t('camera.presentationSaved'));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('camera.presentationSaveFailed'));
      } finally {
        setBusy(false);
      }
    },
    [mediaId, onSaved, t],
  );

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      await api.patch(`/api/media/${mediaId}/splat-presentation`, { presentation: null });
      onSaved({ splatPresentation: null });
      toast.success(t('camera.presentationCleared'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('camera.presentationClearFailed'));
    } finally {
      setBusy(false);
    }
  }, [mediaId, onSaved, t]);

  return { busy, persist, remove };
}
