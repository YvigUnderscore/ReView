// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { ReviewAssignee } from '../../types/entities';
import type { MediaResp } from './reviewTypes';
import { useT } from '../../i18n';

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
  const t = useT();
  const qc = useQueryClient();
  const [reprocessing, setReprocessing] = useState(false);

  /**
   * Publie, et confie la review au passage.
   *
   * Les ReViewers voyagent avec la publication plutôt qu'en un second appel : le serveur
   * les écrit AVANT de basculer le média, ce qui permet au réglage « consigne obligatoire »
   * de refuser la publication au lieu de la laisser partir puis de râler.
   */
  const publishMedia = async (reviewers?: { userId: number; note: string | null }[]) => {
    if (beforePublish && !(await beforePublish())) return;
    try {
      const answer = await api.post<{ media: MediaResp['media']; reviewers: ReviewAssignee[] }>(
        `/api/media/${id}/publish`,
        reviewers ? { reviewers } : {},
      );
      // Mise à jour ciblée du cache : pas de refetch (les URLs présignées changeraient et
      // rechargeraient le viewer) — la réponse porte déjà la liste à jour, il n'y a rien à
      // relire. Seuls le badge, les ReViewers et les brouillons sont concernés.
      qc.setQueryData<MediaResp>(qk.media(id), (old) =>
        old
          ? {
              ...old,
              media: { ...old.media, published: answer.media.published },
              reviewers: answer.reviewers,
            }
          : old,
      );
      // La version porteuse vient de la réponse : pas besoin de la passer en paramètre.
      void qc.invalidateQueries({ queryKey: qk.versionReviewers(answer.media.versionId) });
      void qc.invalidateQueries({ queryKey: qk.drafts });
      void qc.invalidateQueries({ queryKey: ['versions'] });
      toast.success(t('media.publishedTeam'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('media.publishFailed'));
    }
  };

  const reprocessMedia = async () => {
    setReprocessing(true);
    try {
      await api.post(`/api/media/${id}/reprocess`);
      await qc.invalidateQueries({ queryKey: qk.media(id) });
      model3d.clearLoadError();
      toast.success(t('media.reconvertStarted'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('media.reconvertFailed'));
    } finally {
      setReprocessing(false);
    }
  };

  return { reprocessing, publishMedia, reprocessMedia };
}
