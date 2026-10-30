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
 * Sends a guest's feedback: a mirror of `useSubmitComment` on the review side, stripped of
 * everything that presumes an account (attachments, mentions, in-to-out range, author parts).
 *
 * The only trap is time: the client derivative carries a slate at the head that the internal
 * review does not know. The timestamp sent therefore goes through `mediaTimeOf`, otherwise
 * every client remark would arrive offset by the slate duration, three seconds further on than
 * the image being discussed.
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
      // The client portal places only one point: the first in the list goes as `hotspot`, the
      // part the guest schema accepts. A client's feedback stays a client's feedback.
      const annotation = buildGuestAnnotation({ shapes: ann.annot, hotspot: ann.poi.points[0] ?? null });
      const content = guestCommentContent(text, annotation);
      // Neither text nor drawing: there is nothing to send.
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
        // The drawing was sent with the feedback: the composer restarts empty, as internally.
        ann.resetComposer();
        void qc.invalidateQueries({ queryKey: ['client-share', token, 'media', mediaId, 'comments'] });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('common.error.generic'));
      }
    },
    [ann, isVideo, mediaId, qc, slateSec, t, token, videoRef],
  );
}
