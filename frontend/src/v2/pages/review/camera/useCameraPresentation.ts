// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../lib/apiClient';
import type { SplatEditsPatch, SplatPresentation } from '../reviewTypes';
import { useT } from '../../../i18n';

/**
 * Persistance de la présentation caméra (Phase 17), commune 3D/splat : PATCH
 * `/api/media/:id/splat-presentation`, mise à jour du cache (`onSaved`), toasts et état `busy`.
 * Les deux viewers construisent leur objet `SplatPresentation` (le splat ajoute dof/reveal/lod)
 * puis appellent `persist` — un seul chemin réseau, plus de duplication.
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
        toast.error(e instanceof Error ? e.message : "Erreur à l'enregistrement de la présentation");
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
      toast.error(e instanceof Error ? e.message : "Erreur à l'effacement de la présentation");
    } finally {
      setBusy(false);
    }
  }, [mediaId, onSaved, t]);

  return { busy, persist, remove };
}
