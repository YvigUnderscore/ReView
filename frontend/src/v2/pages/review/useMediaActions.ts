// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { MediaResp } from './reviewTypes';

/**
 * Actions de gestion du média de la review (extrait de ReviewPage, budget 300) :
 * publication (verrou Phase 11) et relance de conversion 3D.
 */
export function useMediaActions(
  id: number,
  model3d: { clearLoadError: () => void },
  /**
   * Exécuté avant la publication (46.S) : la mise en scène non enregistrée du gestionnaire
   * devient l'override de base — ce qu'il voit est ce que les reviewers verront par défaut.
   * Renvoyer `false` annule la publication (le média serait figé sans la mise en scène voulue).
   */
  beforePublish?: () => Promise<boolean>,
) {
  const qc = useQueryClient();
  const [reprocessing, setReprocessing] = useState(false);

  const publishMedia = async () => {
    if (beforePublish && !(await beforePublish())) return;
    try {
      const { media } = await api.post<{ media: MediaResp['media'] }>(`/api/media/${id}/publish`);
      // Mise à jour ciblée du cache : pas de refetch (les URLs présignées changeraient
      // et rechargeraient le viewer) — seuls le badge et les brouillons sont concernés.
      qc.setQueryData<MediaResp>(qk.media(id), (old) =>
        old ? { ...old, media: { ...old.media, published: media.published } } : old,
      );
      qc.invalidateQueries({ queryKey: qk.drafts });
      qc.invalidateQueries({ queryKey: ['versions'] });
      toast.success('Média publié pour l’équipe');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur à la publication');
    }
  };

  const reprocessMedia = async () => {
    setReprocessing(true);
    try {
      await api.post(`/api/media/${id}/reprocess`);
      await qc.invalidateQueries({ queryKey: qk.media(id) });
      model3d.clearLoadError();
      toast.success('Conversion relancée');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur à la relance de la conversion');
    } finally {
      setReprocessing(false);
    }
  };

  return { reprocessing, publishMedia, reprocessMedia };
}
