// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, type RefObject } from 'react';
import type { ReviewComment } from '../../types/api';
import type { MediaResp } from './reviewTypes';
import { frameToTime, parseDeepLink } from './deepLink';

/**
 * Applies the review's deep link (32.E) only once, on arrival:
 * `?frame=` → video seek (as soon as metadata is loaded), `?comment=` → full selection of the comment
 * (seek + annotation + camera) and scroll to its card.
 */
export function useDeepLink({
  data,
  comments,
  videoRef,
  programmaticSeekRef,
  fallbackFps,
  selectComment,
}: {
  data: MediaResp | null;
  comments: ReviewComment[] | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  programmaticSeekRef: RefObject<boolean>;
  fallbackFps: number;
  selectComment: (c: ReviewComment) => void;
}) {
  const doneRef = useRef(false);
  useEffect(() => {
    if (doneRef.current || !data) return;
    const dl = parseDeepLink(window.location.search);
    if (dl.commentId != null) {
      if (!comments) return;
      doneRef.current = true;
      const target = dl.commentId;
      const root = comments.find((c) => c.id === target || c.replies?.some((r) => r.id === target));
      if (root) {
        selectComment(root);
        setTimeout(
          () => document.getElementById(`comment-${root.id}`)?.scrollIntoView({ block: 'center' }),
          80,
        );
      }
    } else if (dl.frame != null) {
      doneRef.current = true;
      const v = videoRef.current;
      if (!v) return;
      const t = frameToTime(dl.frame, data.startFrame, data.fps ?? fallbackFps);
      const apply = () => {
        programmaticSeekRef.current = true;
        v.currentTime = t;
      };
      if (v.readyState >= 1) apply();
      else v.addEventListener('loadedmetadata', apply, { once: true });
    }
  });
}
