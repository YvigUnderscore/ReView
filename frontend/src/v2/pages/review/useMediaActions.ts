// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import type { ReviewAssignee } from '../../types/entities';
import type { MediaResp } from './reviewTypes';
import { useT } from '../../i18n';

/**
 * Management actions for the review's media (extracted from ReviewPage, budget 300):
 * publication (Phase 11 lock) and 3D conversion relaunch.
 */
export function useMediaActions(
  id: number,
  model3d: { clearLoadError: () => void },
  /**
   * Run before publication (46.S): the manager's unsaved scene becomes the base override — what they
   * see is what reviewers will see by default. Returning `false` cancels the publication (the media
   * would be frozen without the intended scene).
   */
  beforePublish?: () => Promise<boolean>,
) {
  const t = useT();
  const qc = useQueryClient();
  const [reprocessing, setReprocessing] = useState(false);

  /**
   * Publishes, and hands the review over on the way.
   *
   * The ReViewers travel with the publication rather than in a second call: the server writes them
   * BEFORE switching the media, which lets the "mandatory instruction" setting refuse the publication
   * instead of letting it through and complaining afterwards.
   */
  const publishMedia = async (reviewers?: { userId: number; note: string | null }[]) => {
    if (beforePublish && !(await beforePublish())) return;
    try {
      const answer = await api.post<{ media: MediaResp['media']; reviewers: ReviewAssignee[] }>(
        `/api/media/${id}/publish`,
        reviewers ? { reviewers } : {},
      );
      // Targeted cache update: no refetch (the presigned URLs would change and reload the viewer) — the
      // response already carries the up-to-date list, there is nothing to re-read. Only the badge, the
      // ReViewers and the drafts are affected.
      qc.setQueryData<MediaResp>(qk.media(id), (old) =>
        old
          ? {
              ...old,
              media: { ...old.media, published: answer.media.published },
              reviewers: answer.reviewers,
            }
          : old,
      );
      // The carrying version comes from the response: no need to pass it as a parameter.
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
