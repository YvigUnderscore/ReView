// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ComponentProps } from 'react';
import type { ReviewComment, Role } from '../../types/api';
import { useAuth } from '../../stores/useAuth';
import { useWatermarkConfigQuery } from '../../lib/queries';
import WatermarkOverlay from '../../components/WatermarkOverlay';
import ReviewBriefBanner from '../../components/review/ReviewBriefBanner';
import ImageReviewViewer from '../../components/ImageReviewViewer';
import { Skeleton } from '../../components/ui/skeleton';
import type { MediaResp, SplatEditsPatch } from './reviewTypes';
import { hlsMasterUrl } from './videoSource';
import { useMediaExport } from './useMediaExport';
import { useAnnotationOverlay, usePoiDisplay } from './useAnnotationOverlay';
import { isPoiCardGesture } from './poi/poiAnchor';
import { useImageCompareSync } from './useImageCompareSync';
import type { CompareMode } from './useCompareState';
import type { useAnnotations } from './useAnnotations';
import type { useModel3DThree } from './three/useModel3DThree';
import type { SplatPaintState } from './splat/paint/useSplatPaint';
import type { SplatViewer } from './splat/useSplat';
import ReviewAnnotationBar from './ReviewAnnotationBar';
import Model3DReview from './Model3DReview';
import SplatReview from './splat/SplatReview';
import VideoWipeOverlay from './VideoWipeOverlay';
import VideoPane from './VideoPane';
import VideoReviewSection from './VideoReviewSection';
import VideoProcessingState from './VideoProcessingState';
import { videoPlayback } from './videoPlayback';
import MediaChrome from './MediaChrome';
import ImageReviewSection from './ImageReviewSection';
import { intlLocale } from '../../i18n';

/**
 * Review viewer area: annotation bar + pane matching the media type
 * (video / image / 3D / splat). Extracted from ReviewPage (budget 10.F4). The orchestrator
 * keeps the state; this component only renders the viewer and the annotation overlay.
 */
export default function ReviewViewer({
  data,
  error,
  ann,
  model3d,
  splat,
  paint,
  videoRef,
  programmaticSeekRef,
  comments,
  selectedCommentId,
  fps: storedFps,
  setFpsOverride,
  reprocessing,
  role,
  canEditTransform,
  canEditSplat,
  canManage,
  onClearSelection,
  onSelectComment,
  onManualSeek,
  onMarker,
  onReprocess,
  onSplatEditsSaved,
  onToggleAnnotate,
  onFullscreen,
  compareIds,
  onCloseCompare,
  onRemoveCompare,
  onSetCompare,
  compareMode,
  onCompareModeChange,
  sharedWipe,
  imageViewApiRef,
  onImageUserView,
  onLoopChange,
}: {
  data: MediaResp | null;
  error: string | null;
  ann: ReturnType<typeof useAnnotations>;
  model3d: ReturnType<typeof useModel3DThree>;
  splat: SplatViewer;
  paint: SplatPaintState;
  videoRef: ComponentProps<typeof VideoPane>['videoRef'];
  programmaticSeekRef: ComponentProps<typeof VideoPane>['programmaticSeekRef'];
  comments: ReviewComment[] | null;
  selectedCommentId: number | null;
  fps: number;
  setFpsOverride: (fps: number) => void;
  reprocessing: boolean;
  role?: Role;
  canEditTransform: boolean;
  /** Splat edits (mask, subset) — non-destructive, still valid after publication. */
  canEditSplat: boolean;
  /** Media management (presentation/staging) — still valid after publication. */
  canManage: boolean;
  /** Explicit exit of a comment playback: everything it was showing is released. */
  onClearSelection: () => void;
  onSelectComment: (c: ReviewComment) => void;
  onManualSeek: () => void;
  onMarker: () => void;
  onReprocess: () => void;
  onSplatEditsSaved: (patch: SplatEditsPatch) => void;
  /** Toggles annotation mode (right-click menu). */
  onToggleAnnotate: () => void;
  /** Toggles fullscreen for the whole review block (viewer + playbar + comments). */
  onFullscreen: () => void;
  /** B media (34.D): 1 = classic A/B (side/wipe); 2-3 = video 2×2 grid. */
  compareIds: number[];
  onCloseCompare: () => void;
  /** Removes a single pane from the grid (cell's cross). */
  onRemoveCompare: (mediaId: number) => void;
  /** Exclusive choice of the B media: B setting in the options bar, and mode arming. */
  onSetCompare: (mediaId: number) => void;
  /** Comparison mode lifted to the parent (mirrored in the live session, feedback 33; diff 34.E). */
  compareMode: CompareMode;
  onCompareModeChange: (mode: CompareMode) => void;
  /** Wipe position/angle lifted to the parent (mirrored in the live session). */
  sharedWipe?: ComponentProps<typeof VideoWipeOverlay>['sharedWipe'];
  /** Image view shared in the live session (capture/apply) + takeover on zoom/pan. */
  imageViewApiRef?: ComponentProps<typeof ImageReviewViewer>['viewApiRef'];
  onImageUserView?: () => void;
  /** I/O loop lifted to the parent (34.A) — in→out range of the next comment. */
  onLoopChange?: ComponentProps<typeof VideoPane>['onLoopChange'];
}) {
  const kind = data?.media.kind;
  const src = data?.proxyUrl ?? data?.url;
  // Zoom/pan mirrored between image A/B panes (34.D) — two-way relay.
  const imageSync = useImageCompareSync(imageViewApiRef);
  // Adaptive HLS (Phase 23): master served by the auth proxy when renditions exist
  // **and** the media is not trimmed — the master ignores the trim (see videoSource.ts).
  const hlsUrl = data ? hlsMasterUrl(data.media.id, data) : null;
  const playback = data ? videoPlayback(data.media, data.proxyUrl) : 'play';
  const startFrame = data?.startFrame ?? 1001;
  // Broadcast frame rate: the database only stores a value rounded to the hundredth (23.98 for
  // 24000/1001), from which every frame number drifts. We correct it here, at the viewer's
  // entry, so that the counter, the timeline and the markers count the same frames as the
  // artist's DCC (see frameRate.ts). A frame rate typed by hand, however, stays as is: it is
  // a value the user is writing, not a measurement.
  // The exact frame rate is computed once by ReviewPage and comes down as a prop: recomputing
  // it here had made the viewer counter and the frame numbers shown next to the comments diverge.
  const fps = storedFps;
  // Dock exports (current frame as PNG, contact sheet) — the two buttons of the "Export" panel
  // were only rendered if their actions were passed in.
  const mediaExport = useMediaExport(data, videoRef);
  const splatReady = kind === 'SPLAT' && data?.media.status === 'READY' && splat.ready && !splat.loadError;
  // Publication lock (Phase 11): the editing tools (canEditTransform) disappear
  // as soon as it is published (backend answers 403); the presentation stays controllable (canManage).
  // A/B comparison: side-by-side or wipe (14.C) — mode lifted to the parent (mirrored live).
  const closeCompare = () => (onCompareModeChange('side'), onCloseCompare());

  // 3D/splat points of interest (excerpt — budget 300): those of the selected comment, otherwise
  // those being written. Also renders the comment's cards anchored in the scene.
  const poiCards = usePoiDisplay(kind, ann, splat, model3d, comments, selectedCommentId);

  // 2D annotation overlay (excerpt — budget 300 lines).
  const renderOverlay = useAnnotationOverlay(ann);

  // Exit of an annotated comment playback: a single pill, moved DOWN into the media area of
  // the three viewers that can host it (image, 3D, splat) — at the same edge and in the same
  // language as their other floating markers. Rendered at section level, it used to fall on
  // the chrome header (the mode toggle is centered too).
  const exitViewedAnnotation = (
    <ReviewAnnotationBar ann={ann} onClearSelection={onClearSelection} anchor="viewer" />
  );

  // The signed-in account: the viewer watermark (35.B) reads a name from it, the instruction
  // strip reads an identifier from it — it is the same read, done once.
  const wmUser = useAuth((s) => s.user);
  const wmQ = useWatermarkConfigQuery();
  const watermarkText =
    wmQ.data?.internal && wmUser
      ? `${wmUser.name ?? wmUser.email} — ${new Date().toLocaleDateString(intlLocale())}`
      : null;

  /**
   * Moving the 3D/splat view (orbit, flight, zoom) only hides the **2D drawing** of the selected
   * comment: it alone is traced in the screen plane and only makes sense from the original camera.
   *
   * Everything else is anchored IN the scene — points of interest and brush strokes in object
   * space, scene proposal, camera animation — and so stays displayed while navigating: that was
   * the request ("move the camera, and the staging and points of interest stay displayed").
   * You leave it explicitly: the viewer pill, Escape, another comment, or entering edit mode.
   * The comment also stays selected in the thread — we are still reading it.
   *
   * Video: hiding goes through seek/playback; image: the annotations are anchored to the pixel
   * and survive zoom/pan.
   */
  const hideDrawingOnViewMove = (e: { target: unknown }) => {
    if (kind !== 'MODEL_3D' && kind !== 'SPLAT') return;
    // Expanding an anchored card, or scrolling its text, is not navigating.
    if (isPoiCardGesture(e.target)) return;
    if (ann.viewed) {
      ann.setViewed(null);
      ann.setViewedAspect(null);
    }
  };

  return (
    <section
      className="relative flex min-w-0 flex-1 flex-col gap-2"
      onPointerDownCapture={hideDrawingOnViewMove}
      onWheelCapture={hideDrawingOnViewMove}
    >
      {watermarkText && <WatermarkOverlay text={watermarkText} opacity={wmQ.data?.opacity} />}
      {/* Cards of the reviewed comment, anchored to their points in the scene. Rendered here
          only because they have to be rendered somewhere: they are portaled into the viewer's
          pins, so their place in this tree has no effect on screen. */}
      {poiCards}
      {/* What you are asked to look at, when the review was entrusted to you: above the
          viewer, on opening, and not three clicks away in a dialog. */}
      {data && <ReviewBriefBanner reviewers={data.reviewers} currentUserId={wmUser?.id} />}
      {/* The video player keeps the pill at section level: its media area belongs to another
          workstream. The other three receive it in their viewer (see below). */}
      {kind === 'VIDEO' && <ReviewAnnotationBar ann={ann} onClearSelection={onClearSelection} />}

      {/* Viewer skeleton while loading (10.B5) */}
      {!data && !error && <Skeleton className="min-h-0 flex-1 rounded-lg" />}

      {kind === 'VIDEO' && data && playback !== 'play' && (
        <VideoProcessingState
          state={playback}
          processingError={data.processingError}
          canReprocess={role !== 'CLIENT'}
          reprocessing={reprocessing}
          onReprocess={onReprocess}
        />
      )}

      {kind === 'VIDEO' && src && data && playback === 'play' && (
        <MediaChrome
          kind="VIDEO"
          data={data}
          fps={fps}
          ann={ann}
          role={role}
          onExportFrame={mediaExport.onExportFrame}
          onContactSheet={mediaExport.onContactSheet}
          compare={{
            mode: compareMode,
            onMode: onCompareModeChange,
            ids: compareIds,
            onClear: closeCompare,
            onSet: onSetCompare,
          }}
        >
          <VideoReviewSection
            data={data}
            src={src}
            hlsUrl={hlsUrl}
            videoRef={videoRef}
            programmaticSeekRef={programmaticSeekRef}
            overlay={renderOverlay()}
            comments={comments ?? []}
            selectedId={selectedCommentId}
            onSelectComment={onSelectComment}
            onManualSeek={onManualSeek}
            onMarker={onMarker}
            fps={fps}
            setFpsOverride={setFpsOverride}
            startFrame={startFrame}
            onFullscreen={onFullscreen}
            onLoopChange={onLoopChange}
            canManage={canManage}
            ann={ann}
            onToggleAnnotate={onToggleAnnotate}
            onClearSelection={onClearSelection}
            compareIds={compareIds}
            compareMode={compareMode}
            onCompareModeChange={onCompareModeChange}
            onRemoveCompare={onRemoveCompare}
            closeCompare={closeCompare}
            sharedWipe={sharedWipe}
          />
        </MediaChrome>
      )}

      {kind === 'IMAGE' && data?.url && (
        <ImageReviewSection
          data={data}
          fps={fps}
          ann={ann}
          role={role}
          canManage={canManage}
          selectedCommentId={selectedCommentId}
          videoRef={videoRef}
          imageSync={imageSync}
          imageViewApiRef={imageViewApiRef}
          onImageUserView={onImageUserView}
          exit={exitViewedAnnotation}
          onFullscreen={onFullscreen}
          onToggleAnnotate={onToggleAnnotate}
          onClearSelection={onClearSelection}
          compareIds={compareIds}
          compareMode={compareMode}
          onCompareModeChange={onCompareModeChange}
          onSetCompare={onSetCompare}
          closeCompare={closeCompare}
          sharedWipe={sharedWipe}
        />
      )}

      {kind === 'MODEL_3D' && data && (
        <Model3DReview
          data={data}
          model3d={model3d}
          ann={ann}
          canManage={canManage}
          showEditTools={canEditTransform}
          role={role}
          reprocessing={reprocessing}
          onReprocess={onReprocess}
          onSaved={onSplatEditsSaved}
          paint={paint}
          overlay={renderOverlay(ann.viewedAspect ?? undefined)}
          exit={exitViewedAnnotation}
        />
      )}

      {kind === 'SPLAT' && data && (
        <SplatReview
          data={data}
          splat={splat}
          showEdit={splatReady && canEditSplat}
          canPresent={splatReady && canManage}
          paint={paint}
          onSaved={onSplatEditsSaved}
          role={role}
          overlay={renderOverlay()}
          exit={exitViewedAnnotation}
          ann={ann}
        />
      )}

      {/* The version's assets live in the chrome's "filmstrip" drawer (D1):
          they used to be rendered here *and* there, twice on the same screen. */}
    </section>
  );
}
