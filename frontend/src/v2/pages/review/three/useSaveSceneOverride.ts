// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { useT } from '../../../i18n';

/**
 * Enregistrement de l'override de scène USD comme **base du média** (46.D) : ce que le
 * gestionnaire voit devient ce que tout le monde verra. Réservé aux gestionnaires et refusé
 * après publication (verrou P11, vérifié côté serveur) — le hook n'expose alors aucune action.
 *
 * Extrait de `Model3DReview` (budget de lignes) : l'orchestrateur ne garde que le câblage.
 */
export function useSaveSceneOverride(params: {
  mediaId: number;
  allowed: boolean;
  /** Override fusionné à envoyer (base + exploration locale). */
  merged: () => unknown;
  /** Remet l'exploration locale à zéro une fois la base enregistrée. */
  onSaved: () => void;
}) {
  const { mediaId, allowed, merged, onSaved } = params;
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const run = useCallback(() => {
    setBusy(true);
    api
      .put(`/api/media/${mediaId}/usd/override`, { override: merged() })
      .then(() => {
        toast.success(t('review.staging.saved'));
        void qc.invalidateQueries({ queryKey: qk.media(mediaId) });
        onSaved();
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : t('common.error.save')))
      .finally(() => setBusy(false));
  }, [mediaId, merged, onSaved, qc, t]);

  return { busy, run: allowed ? run : undefined };
}
