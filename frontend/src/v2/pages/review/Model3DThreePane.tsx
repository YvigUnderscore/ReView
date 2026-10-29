// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ReactNode, type RefObject } from 'react';
import { RotateCcw } from 'lucide-react';
import { VIEWER_ZONE } from './reviewTypes';
import ReviewFrame from './ReviewFrame';
import { useT } from '../../i18n';

/**
 * 3D pane of the review (**Three.js** viewer): the `useModel3DThree` hook mounts the scene in
 * `containerRef` (always present). Fixed-aspect review frame (V6), stacked 2D annotation
 * overlay, fallback states (conversion in progress / failure with retry). Replaces
 * `Model3DPane` (model-viewer).
 */
export default function Model3DThreePane({
  status,
  loadError,
  containerRef,
  overlay,
  editorOverlay,
  aspect,
  pip,
  notice,
  exit,
  settings,
  recording,
  canReprocess,
  reprocessing,
  processingError,
  onReprocess,
}: {
  status: string;
  loadError: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  overlay: ReactNode;
  /**
   * Interactive overlay for the scene tools — the surface brush (batch 13). Unlike `overlay`,
   * it CAPTURES the pointer: it is the same slot, in the same place, as the splat pane's, so
   * the brush behaves identically in both viewers.
   */
  editorOverlay?: ReactNode;
  /** Aspect of the fixed review frame (from the persisted presentation) — default 16:9. */
  aspect?: number;
  /** PiP window of layout mode (PipFrame — the WebGL render is drawn underneath, scissored). */
  pip?: ReactNode;
  /** Floating banner at the top of the viewer (46.T: back to the default scene). */
  notice?: ReactNode;
  /**
   * Exit of an annotated comment playback, at the BOTTOM of the viewer: the centered top is
   * already used by the status banners (`notice`), and two pills on the same edge would overlap.
   */
  exit?: ReactNode;
  /**
   * Render settings, placed at the TOP LEFT of the viewer (Phase 50, batch 6) — the "Display"
   * dock tab was removed in favor of this corner: you change the render mode while looking at
   * the model, not by crossing the screen. Absent from the client share, which adjusts nothing.
   */
  settings?: ReactNode;
  /** Auto-key armed: recording border on the viewport (DCC style). */
  recording?: boolean;
  canReprocess: boolean;
  reprocessing: boolean;
  /** Processing failure reason surfaced by the worker (45.C), null if unknown. */
  processingError?: string | null;
  onReprocess: () => void;
}) {
  const t = useT();
  const showError = loadError || (status !== 'PROCESSING' && status !== 'READY');
  return (
    <div className={VIEWER_ZONE} data-viewer-zone>
      {recording && (
        <div className="pointer-events-none absolute inset-0 z-20 ring-2 ring-destructive/70 ring-inset" />
      )}
      {/* Full-space viewer + letterbox guide of the delivery frame (Phase 25); the overlay
          is anchored to the guide (normalized coordinates aligned for everyone). */}
      <ReviewFrame
        aspect={aspect}
        frame={overlay && <div className="pointer-events-none absolute inset-0">{overlay}</div>}
      >
        {/* Three.js scene container (filled by useModel3DThree) — always mounted */}
        <div ref={containerRef} className="absolute inset-0" />

        {/* Scene tools overlay (brush) — above the canvas, below the states */}
        {editorOverlay}

        {pip}
      </ReviewFrame>
      {notice}
      {exit}
      {/* Above the frame, never inside it: the letterbox guide and the annotation overlay
          keep their coordinates — this corner does not touch the framing. */}
      {settings && <div className="absolute top-2 left-2 z-20">{settings}</div>}

      {status === 'PROCESSING' ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm text-muted-foreground">{t('review.converting')}</span>
        </div>
      ) : showError ? (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm space-y-3 text-center text-sm text-muted-foreground">
            <p>{t('model3d.unviewable')}</p>
            {/* Reason surfaced by the worker (45.C): missing USD asset, missing tooling,
                archive rejected… — without it, the user does not know what to fix. */}
            {processingError && (
              <p className="rounded border border-border bg-card/60 px-2 py-1.5 text-left font-mono text-xs break-words text-foreground">
                {processingError}
              </p>
            )}
            {canReprocess && (
              <button
                onClick={onReprocess}
                disabled={reprocessing}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                <RotateCcw size={13} /> {reprocessing ? t('common.retrying') : t('model3d.reconvert')}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
