// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clientApi } from './clientApi';
import { buildGuestAnnotation, guestCommentContent } from './clientAnnotation';
import { mediaTimeOf } from './clientViewerModel';
import type { Annotations } from '../review/useAnnotations';
import { useT } from '../../i18n';

/**
 * Envoi d'un retour d'invité — miroir de `useSubmitComment` côté review, amputé de tout ce
 * qui suppose un compte (pièces jointes, mentions, plage in→out, parts d'auteur).
 *
 * Le seul piège est le temps : le dérivé client porte un slate en tête que la review interne
 * ne connaît pas. Le timestamp envoyé passe donc par `mediaTimeOf`, sans quoi chaque
 * remarque d'un client arriverait décalée de la durée du slate — trois secondes plus loin
 * que l'image dont il parle.
 */
export function useClientSubmitComment(opts: {
  token: string;
  mediaId: number;
  isVideo: boolean;
  slateSec: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  ann: Annotations;
}) {
  const { token, mediaId, isVideo, slateSec, videoRef, ann } = opts;
  const t = useT();
  const qc = useQueryClient();

  return useCallback(
    async (guestName: string, text: string) => {
      const annotation = buildGuestAnnotation({ shapes: ann.annot, hotspot: ann.hotspot3d });
      const content = guestCommentContent(text, annotation);
      // Ni texte ni dessin : il n'y a rien à envoyer.
      if (content === null) return;
      try {
        localStorage.setItem('client-guest-name', guestName);
        const timestamp =
          isVideo && videoRef.current ? mediaTimeOf(videoRef.current.currentTime, slateSec) : undefined;
        await clientApi.post(token, `/media/${mediaId}/comments`, {
          guestName,
          content,
          ...(timestamp !== undefined ? { timestamp } : {}),
          ...(annotation ? { annotation } : {}),
        });
        toast.success(t('comments.sent'));
        // Le dessin est parti avec le retour : le composer repart vide, comme en interne.
        ann.resetComposer();
        void qc.invalidateQueries({ queryKey: ['client-share', token, 'media', mediaId, 'comments'] });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('common.error.generic'));
      }
    },
    [ann, isVideo, mediaId, qc, slateSec, t, token, videoRef],
  );
}
