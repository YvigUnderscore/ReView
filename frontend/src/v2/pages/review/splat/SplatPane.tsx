// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ReactNode, type RefObject } from 'react';
import { VIEWER_ZONE } from '../reviewTypes';
import ReviewFrame from '../ReviewFrame';
import { useT } from '../../../i18n';

/**
 * Gaussian Splat pane of the review (Spark / SparkJS viewer), batch 10.G.
 * The `useSplat` hook mounts the Three.js scene in `containerRef`; this component handles the fixed-aspect
 * review frame (V6: letterboxed canvas, not stretched to the screen), the fallback states (loading, failure)
 * and the overlaid 2D annotation overlay.
 */
export default function SplatPane({
  containerRef,
  ready,
  loadError,
  progress,
  status,
  overlay,
  editorOverlay,
  pip,
  settings,
  aspect,
  recording,
  notice,
  exit,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  ready: boolean;
  loadError: boolean;
  /** Download progress (0..1) or null (decoding / LOD in progress), 41.B. */
  progress: number | null;
  status: string;
  overlay: ReactNode;
  /** Interactive overlay of the editor (selection trace): captures the pointer, unlike `overlay`. */
  editorOverlay?: ReactNode;
  /** PiP window of layout mode (PipFrame: the WebGL rendering is drawn underneath with scissor). */
  pip?: ReactNode;
  /**
   * Viewer menus, placed TOP LEFT (Phase 50, batch 12): cloud editing and rendering settings, in the same
   * corner and the same language as those of the 3D model (batch 6). Absent from the client share, which
   * adjusts nothing.
   */
  settings?: ReactNode;
  /** Aspect of the fixed review frame (from the presentation camera): 16:9 default (V6). */
  aspect?: number;
  /** Auto-key armed: recording outline on the viewport (DCC-style). */
  recording?: boolean;
  /** Status banner placed above the cloud (placement of a point of interest): 3D twin. */
  notice?: ReactNode;
  /**
   * Exit of the playback of an annotated comment, at the BOTTOM of the viewer: same edge and same pill as
   * the 3D model and the image. The centred top belongs to the status banner.
   */
  exit?: ReactNode;
}) {
  const t = useT();
  return (
    <div className={VIEWER_ZONE} data-viewer-zone>
      {recording && (
        <div className="pointer-events-none absolute inset-0 z-20 ring-2 ring-destructive/70 ring-inset" />
      )}
      {/* Full-space viewer + letterbox guide of the delivery frame (Phase 25). The 2D annotation overlay is
          anchored to the guide; the editor selection stays full-frame. */}
      <ReviewFrame
        aspect={aspect}
        frame={overlay && <div className="pointer-events-none absolute inset-0">{overlay}</div>}
      >
        {/* Container of the Three.js scene (filled by useSplat): always mounted */}
        <div ref={containerRef} className="absolute inset-0" />

        {/* Editing overlay (rectangle / lasso selection): above the canvas, below the states */}
        {editorOverlay}

        {pip}
      </ReviewFrame>

      {notice}
      {exit}

      {/* Above the frame, never inside it: the letterbox guide and the annotation overlay keep their
          coordinates; this corner does not touch the framing. */}
      {settings && <div className="absolute top-2 left-2 z-20">{settings}</div>}

      {/* Fallback states: centred across the whole zone (outside the letterbox) */}
      {loadError ? (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p className="max-w-sm text-center text-sm text-muted-foreground">{t('splat.unviewable')}</p>
        </div>
      ) : status === 'PROCESSING' || !ready ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          {/* 41.B: real progress bar during download (large scenes); once the file has been received
              (progress null), we switch to indeterminate decoding. */}
          {typeof progress === 'number' && progress < 1 ? (
            <>
              <span className="text-sm text-muted-foreground">
                {t('splat.downloading', { pct: Math.round(progress * 100) })}
              </span>
              <div className="h-1 w-40 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-150"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">{t('review.splat.loading')}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
