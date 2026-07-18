import { useEffect, useRef, type RefObject } from 'react';
import type { ReviewComment } from '../../types/api';
import type { MediaResp } from './reviewTypes';
import { frameToTime, parseDeepLink } from './deepLink';

/**
 * Applique le lien profond de la review (32.E) une seule fois à l'arrivée :
 * `?frame=` → seek vidéo (dès les métadonnées chargées), `?comment=` → sélection
 * complète du commentaire (seek + annotation + caméra) et scroll vers sa carte.
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
