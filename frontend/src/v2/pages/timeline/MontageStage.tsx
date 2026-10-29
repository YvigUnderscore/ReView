// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { FileWarning } from 'lucide-react';
import { VIEWER_ZONE } from '../review/reviewTypes';
import { isStillClip } from './timelinePlayback';
import type { TimelineClip } from '../../types/api';
import { useT } from '../../i18n';

/**
 * The montage image (Phase 46), in the same frame as the review viewer.
 *
 * Two players take turns: while one shot plays, the next one loads in the second, off-screen, and
 * switching is only a visibility swap. Both stay mounted permanently — unmounting the outgoing one
 * would cancel the preload and bring back black between shots, which a montage must precisely avoid.
 *
 * The annotation shares exactly the image's box, computed at its real ratio: a drawing that does
 * not land on the targeted pixel is no better than no drawing.
 */
export default function MontageStage({
  clip,
  active,
  videoA,
  videoB,
  overlay,
  onClick,
  zoneRef,
  stillUrl,
}: {
  clip: TimelineClip | null;
  active: 'A' | 'B';
  videoA: RefObject<HTMLVideoElement | null>;
  videoB: RefObject<HTMLVideoElement | null>;
  /** Annotation layer, rendered at the size of the image. */
  overlay?: ReactNode;
  onClick?: () => void;
  /** Image zone — target of the transport's "video only" fullscreen. */
  zoneRef?: RefObject<HTMLDivElement | null>;
  /** Full-resolution source when the current shot is a still image. */
  stillUrl?: string | null;
}) {
  const t = useT();
  const local = useRef<HTMLDivElement>(null);
  const zone = zoneRef ?? local;
  const [aspect, setAspect] = useState(16 / 9);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const card = clip !== null && clip.mediaId === null;
  // A shot whose published version is an image: it takes its place in the montage, but does NOT
  // go through the video element — a JPEG handed to `<video>` fails demuxing and blocked playback
  // of the whole montage as soon as the first shot carried one.
  const still = isStillClip(clip);
  const stillSrc = stillUrl ?? clip?.thumbnailUrl ?? null;

  // Display box: the image fills all the available space at its ratio, and the overlay shares
  // the same box — same computation as the review player.
  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    const fit = () => {
      const h = Math.min(el.clientHeight, el.clientWidth / aspect);
      setBox({ w: h * aspect, h });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect, zone]);

  const onMeta = (el: HTMLVideoElement, slot: 'A' | 'B') => {
    if (slot === active && el.videoWidth > 0) setAspect(el.videoWidth / el.videoHeight);
  };

  return (
    <div ref={zone} className={VIEWER_ZONE}>
      <div className="relative" style={box ? { width: box.w, height: box.h } : undefined}>
        <video
          ref={videoA}
          onClick={onClick}
          onLoadedMetadata={(e) => onMeta(e.currentTarget, 'A')}
          className={`absolute inset-0 h-full w-full cursor-pointer object-contain ${
            active === 'A' && !card && !still ? '' : 'invisible'
          }`}
          playsInline
          crossOrigin="anonymous"
        />
        <video
          ref={videoB}
          onClick={onClick}
          onLoadedMetadata={(e) => onMeta(e.currentTarget, 'B')}
          className={`absolute inset-0 h-full w-full cursor-pointer object-contain ${
            active === 'B' && !card && !still ? '' : 'invisible'
          }`}
          playsInline
          crossOrigin="anonymous"
        />
        {still && stillSrc && (
          // A button rather than `<img onClick>`: the image takes the player's place, and
          // "click to play/pause" must respond to the keyboard as well as the pointer.
          <button
            type="button"
            onClick={onClick}
            aria-label={t('timeline.navHint')}
            className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0"
          >
            <img
              src={stillSrc}
              alt={clip?.mediaName ?? ''}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0) setAspect(img.naturalWidth / img.naturalHeight);
              }}
              className="h-full w-full object-contain"
              crossOrigin="anonymous"
            />
          </button>
        )}
        {overlay}
        {card && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <FileWarning size={30} className="text-warning" />
            <span className="text-sm font-medium text-foreground">{clip?.shotCode}</span>
            <span className="text-xs">{t('timeline.noMedia')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
