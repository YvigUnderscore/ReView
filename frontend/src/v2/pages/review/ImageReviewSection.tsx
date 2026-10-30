// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ComponentProps, ReactNode, RefObject } from 'react';
import ImageReviewViewer from '../../components/ImageReviewViewer';
import ReviewCanvasRefs, { ReviewCanvasRefsControls } from './ReviewCanvasRefs';
import ReviewContextMenu from './ReviewContextMenu';
import CompositionGuides from './CompositionGuides';
import ImageComparePane from './ImageComparePane';
import ImageWipeOverlay from './ImageWipeOverlay';
import { ImageDiffOverlay } from './DiffOverlay';
import MediaChrome from './MediaChrome';
import DisplayTransformOverlay from './color/DisplayTransformOverlay';
import { useDisplayTransform } from './color/useDisplayTransform';
import { imageCompareOverlay } from './header/headerComposition';
import { VIEWER_ZONE, type MediaResp } from './reviewTypes';
import type { useImageCompareSync } from './useImageCompareSync';
import type { Annotations } from './useAnnotations';
import type { CompareMode } from './useCompareState';
import type { Role } from '../../types/api';

/**
 * **Image** branch of the review viewer: annotatable viewer, or a comparison overlay
 * (wipe / difference) in place of the viewport. Both live **inside** the chrome: the
 * comparison used to unmount it, and the mode toggle and A/B settings vanished exactly
 * when they were needed.
 */
export default function ImageReviewSection({
  data,
  fps,
  ann,
  role,
  canManage,
  selectedCommentId,
  videoRef,
  imageSync,
  imageViewApiRef,
  onImageUserView,
  exit,
  onFullscreen,
  onToggleAnnotate,
  onClearSelection,
  compareIds,
  compareMode,
  onCompareModeChange,
  onSetCompare,
  closeCompare,
  sharedWipe,
}: {
  data: MediaResp;
  fps: number;
  ann: Annotations;
  role?: Role;
  canManage: boolean;
  selectedCommentId: number | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  imageSync: ReturnType<typeof useImageCompareSync>;
  imageViewApiRef?: ComponentProps<typeof ImageReviewViewer>['viewApiRef'];
  onImageUserView?: () => void;
  /**
   * Exit of an annotated comment playback — placed INSIDE the media area, outside the zoomed
   * layer (which creates its own stacking context): the pill stays above the drawing and at
   * screen scale, whatever the magnification.
   */
  exit?: ReactNode;
  onFullscreen: () => void;
  onToggleAnnotate: () => void;
  onClearSelection: () => void;
  compareIds: number[];
  compareMode: CompareMode;
  onCompareModeChange: (mode: CompareMode) => void;
  /** Exclusive choice of the B media (B setting, arming the "Compare" mode). */
  onSetCompare: (mediaId: number) => void;
  closeCompare: () => void;
  sharedWipe?: ComponentProps<typeof ImageWipeOverlay>['sharedWipe'];
}) {
  const compareId = compareIds[0] ?? null;
  // Display transform (OCIO) of image A. The comparison overlays keep the raw image:
  // comparing two versions means looking at them in the same state.
  const display = useDisplayTransform(data.url, data.projectColor);

  // Wipe and difference replace the viewport, with zoom suspended there — but not the
  // chrome: `imageCompareOverlay` only decides the content of the media area.
  const overlay = imageCompareOverlay(compareId, compareMode);

  return (
    <MediaChrome
      kind="IMAGE"
      data={data}
      fps={fps}
      ann={ann}
      role={role}
      compare={{
        mode: compareMode,
        onMode: onCompareModeChange,
        ids: compareIds,
        onClear: closeCompare,
        onSet: onSetCompare,
      }}
    >
      {compareId != null && overlay === 'wipe' && (
        <div className="flex min-h-0 flex-1">
          <ImageWipeOverlay
            aUrl={data.url}
            aName={data.media.originalName}
            compareId={compareId}
            onClose={closeCompare}
            sharedWipe={sharedWipe}
          />
        </div>
      )}
      {compareId != null && overlay === 'diff' && (
        <div className="flex min-h-0 flex-1">
          <ImageDiffOverlay
            aUrl={data.url}
            compareId={compareId}
            onClose={closeCompare}
            onSide={() => onCompareModeChange('side')}
            onWipe={() => onCompareModeChange('wipe')}
          />
        </div>
      )}
      {!overlay && (
        <div className="flex min-h-0 flex-1 gap-3">
          <ReviewContextMenu
            data={data}
            videoRef={videoRef}
            fps={fps}
            canManage={canManage}
            annotating={ann.annotating}
            onToggleAnnotate={onToggleAnnotate}
            hasViewed={!!ann.viewed}
            onClearSelection={onClearSelection}
            annShapes={ann.viewed ?? ann.annot}
          >
            <div className={VIEWER_ZONE} data-viewer-zone>
              <div className="absolute inset-0">
                <ImageReviewViewer
                  src={data.url}
                  alt={data.media.originalName}
                  shapes={ann.viewed ?? ann.annot}
                  onChange={ann.setShapes}
                  editable={ann.annotating && !ann.viewed}
                  tool={ann.tool}
                  color={ann.color}
                  width={ann.penWidth}
                  alpha={ann.alpha}
                  info={{ format: data.media.originalName.split('.').pop()?.toUpperCase() ?? null }}
                  onFullscreen={onFullscreen}
                  // The judged viewer carries `F` / `H`; the comparison panes do not.
                  viewShortcuts
                  viewApiRef={imageViewApiRef}
                  onUserView={onImageUserView}
                  onViewChange={compareId != null ? imageSync.onMasterView : undefined}
                  pinned={
                    <>
                      {/* Color management: the transformed image sits **above** the original
                        in the zoomed plane. Going through `src` would redo the framing on
                        every exposure step. */}
                      <DisplayTransformOverlay url={display.url} />
                      {/* Composition guides: the overlay was only mounted in the video player,
                        so the "Guides" tab of the image dock did nothing. */}
                      <CompositionGuides />
                      <ReviewCanvasRefs
                        mediaId={data.media.id}
                        references={data.references ?? []}
                        selectedCommentId={selectedCommentId}
                        canManage={canManage}
                        ann={ann}
                      />
                    </>
                  }
                />
              </div>
              <ReviewCanvasRefsControls ann={ann} annotating={ann.annotating} />
              {/* Rendered after the zoomed layer, so it sits above it without relying on a
                  z-index that a local stacking context would swallow. */}
              {exit}
            </div>
          </ReviewContextMenu>
          {/* Image A/B side-by-side comparison — mirrored zoom/pan. */}
          {compareId != null && compareMode === 'side' && (
            <ImageComparePane
              compareId={compareId}
              onClose={closeCompare}
              onWipe={() => onCompareModeChange('wipe')}
              onDiff={() => onCompareModeChange('diff')}
              viewApiRef={imageSync.slaveApiRef}
              onViewChange={imageSync.onSlaveView}
            />
          )}
        </div>
      )}
    </MediaChrome>
  );
}
