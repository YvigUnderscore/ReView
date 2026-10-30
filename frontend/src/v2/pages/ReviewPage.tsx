// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { mediaSlug, parseIdParam } from '../lib/slug';
import { useCanonicalSlug } from '../lib/useCanonicalSlug';
import { useAuth } from '../stores/useAuth';
import { userColor } from '../lib/userColor';
import PageShell from '../components/PageShell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import type { ReviewComment } from '../types/api';
import { type Shape } from '../components/AnnotationCanvas';
import type { ImageViewApi } from '../components/ImageReviewViewer';
import { resolveGlbSrc, splitAnnotationParts } from './review/reviewTypes';
import { readPoiPoints, type PoiPoint } from './review/poi/poiPoints';
import { usePublishSceneOverride } from './review/usePublishSceneOverride';
import { useAnnotations } from './review/useAnnotations';
import { loadDraft, saveDraft } from './review/commentDraft';
import { useCompareState } from './review/useCompareState';
import { useDeepLink } from './review/useDeepLink';
import { useTimelineChain } from './review/useTimelineChain';
import { useLiveSession } from './review/useLiveSession';
import { useMediaActions } from './review/useMediaActions';
import { useReviewViewport } from './review/useReviewViewport';
import { useSubmitComment } from './review/useSubmitComment';
import { useTimelineMarkers } from './review/useTimelineMarkers';
import { useSplatThumbnail } from './review/useSplatThumbnail';
import { useAutoThumbnail } from './review/useAutoThumbnail';
import { useModel3DThree } from './review/three/useModel3DThree';
import { ReviewHeaderSlotsContext } from './review/header/reviewHeaderSlots';
import ReviewViewer from './review/ReviewViewer';
import { exactFrameRate } from './review/frameRate';
import { mediaReviewAspect } from './review/reviewAspect';
import { ErrorBoundary } from '../components/ui/error-boundary';
import { useSplatPaint } from './review/splat/paint/useSplatPaint';
import { useSplat } from './review/splat/useSplat';
import { resolveSplatEditProposal } from './review/splat/splatEditPart';
import { useReviewHeaderSlots } from './review/header/useReviewHeaderSlots';
import ReviewPageHeader from './review/header/ReviewPageHeader';
import TheaterExitButton from './review/TheaterExitButton';
import { useReviewMedia } from './review/useReviewMedia';

/** Review of a media item (video/image/3D); orchestrates the panes (split 10.C2). */
export default function ReviewPage() {
  const { mediaId } = useParams();
  const id = parseIdParam(mediaId);
  // key: resets all state (annotations, selection, video) when the media
  // changes (previous/next navigation or version change) without leaving the screen.
  return <ReviewContent key={id} id={id} rawParam={mediaId} />;
}

function ReviewContent({ id, rawParam }: { id: number; rawParam?: string }) {
  const userId = useAuth((s) => s.user?.id) ?? 0;
  const role = useAuth((s) => s.user?.role);

  const qc = useQueryClient();
  const [commentsOpen, setCommentsOpen] = useState(true);
  // Comment currently displayed (highlighted card + visible annotation)
  const [selectedCommentId, setSelectedCommentId] = useState<number | null>(null);
  const [fpsOverride, setFpsOverride] = useState(24);
  // A/B comparison, mode and wipe are lifted here so they can be replicated live (feedback 33).
  const compare = useCompareState();
  // I/O loop lifted from the player (34.A): in→out range of the next comment.
  const [loop, setLoop] = useState<{ in: number | null; out: number | null }>({ in: null, out: null });

  const videoRef = useRef<HTMLVideoElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Flag: tells a programmatic seek apart from a manual move (which deselects).
  const programmaticSeekRef = useRef(false);

  // Unified display modes (browser fullscreen + in-window theater + PiP): see hook.
  // The whole review block (header + viewer + playbar + comments) goes fullscreen,
  // not just the viewer area, so the transport bar and comments stay visible.
  const { reviewRootRef, isFullscreen, toggleFullscreen, theater, setTheater, togglePictureInPicture } =
    useReviewViewport(videoRef);

  const mediaQ = useReviewMedia(id);
  const data = mediaQ.data ?? null;
  // Readable URL: `/review/219` → `/review/perso-principal-v01-219` as soon as the name is known.
  useCanonicalSlug(rawParam, data ? mediaSlug(data.media.originalName, id) : null);
  const commentsQ = useQuery({
    queryKey: qk.comments(id),
    queryFn: () =>
      api.get<{ items: ReviewComment[] }>(`/api/comments?mediaObjectId=${id}`).then((d) => d.items),
  });
  const comments = commentsQ.data ?? null;
  const error = (mediaQ.error ?? commentsQ.error)?.message ?? null;

  // Per-user annotation color (14.F): saved preference, otherwise a hue
  // derived from the id (aligned with avatars); a manual choice is persisted.
  const prefsQ = useQuery({
    queryKey: qk.preferences,
    queryFn: () =>
      api
        .get<{ preferences: { annotationColor?: string } }>('/api/users/me/preferences')
        .then((d) => d.preferences),
    staleTime: 5 * 60_000,
  });
  const defaultColor = prefsQ.data?.annotationColor ?? userColor(userId);
  const ann = useAnnotations({
    defaultColor,
    onColorChange: (c) => {
      void api.patch('/api/users/me/preferences', { annotationColor: c });
    },
    // Local draft (32.C): in-progress 2D shapes survive a reload.
    initialShapes: () => (loadDraft(id)?.shapes as Shape[] | undefined) ?? [],
  });
  useEffect(() => saveDraft(id, { shapes: ann.annot }), [ann.annot, id]);
  const glbSrc = resolveGlbSrc(data);
  const model3d = useModel3DThree(data, glbSrc);
  // Gaussian Splat viewer (Spark), mounted only for a SPLAT media (10.G).
  const splatUrl = data?.media.kind === 'SPLAT' ? data.url : null;
  const splat = useSplat(splatUrl, data?.media.originalName ?? '', mediaReviewAspect(data).value);
  // Surface brush: strokes are attached to the next comment; the eraser rewrites those of a
  // comment already sent, hence the media id (invalidates the thread).
  //
  // The SAME hook serves both spatial types since batch 13 (it only reads the shared scene
  // handle), so we pass it the open media's viewer. One call, one state: two instances would
  // have produced two stroke stacks, one of them invisible at send time.
  const spatialMedia = data?.media.kind === 'MODEL_3D' || data?.media.kind === 'SPLAT';
  const paint = useSplatPaint(data?.media.kind === 'MODEL_3D' ? model3d : splat, spatialMedia, id);

  const loadComments = useCallback(() => qc.invalidateQueries({ queryKey: qk.comments(id) }), [qc, id]);

  // Publish lock (Phase 11, table revised in Phase 50): a published media refuses
  // video editing, a version's `transform`, and splat edit writes "for everyone". Writes that
  // do not touch the original file and do not rewrite what others comment on remain allowed:
  // thumbnail, staging, USD override.
  const canManageMedia = role === 'ADMIN' || role === 'SUPERVISOR' || data?.media.uploaderId === userId;
  /**
   * Splat editor MOUNTED: manager or not, published or not. Editing stays available after publishing;
   * only the SAVE-for-everyone stops there (`SplatReview`, server lock). Beyond that,
   * the edit goes into a comment, like the 3D scene proposal.
   */
  const canEditSplat = canManageMedia;
  /**
   * 3D transform: the right comes from the SERVER (`permissions.editTransform`), not from a role
   * rule copied here. The old one, "unpublished + internal role", offered gizmos and the
   * "Save" button to an artist who is not the version's author, which `VersionService.update`
   * then refuses with a 403. Absent (detail not loaded yet): no.
   */
  const canEditTransform = data?.permissions.editTransform ?? false;
  // Auto thumbnail on first view (splat + 3D), all viewers, if missing (Phase 20).
  useAutoThumbnail(id, data, 'SPLAT', splat.ready, splat.captureThumbnail);
  useAutoThumbnail(id, data, 'MODEL_3D', model3d.ready, model3d.captureThumbnail);
  // Cache patch after saving splat edits + manager recapture (10.F4).
  const onSplatEditsSaved = useSplatThumbnail(id, splat, canEditSplat);

  const seek = (t: number) => {
    if (!videoRef.current) return;
    programmaticSeekRef.current = true;
    videoRef.current.currentTime = t;
  };

  // Deselects the current comment and releases everything it displayed: drawing, points of
  // interest, brush strokes, proposed scene. This is the EXPLICIT exit (viewer pill,
  // Escape, another comment, entering composition). A view movement, on the other hand, only hides
  // the 2D drawing, the only part that depends on the original camera (see `ReviewViewer`).
  const clearSelection = () => {
    setSelectedCommentId(null);
    ann.clearViewed();
    paint.showFromAnnotation(null);
  };

  // Comment selection: restores seek + 2D/3D annotation + camera together (animated).
  const selectComment = (c: ReviewComment) => {
    setSelectedCommentId(c.id);
    const { shapes, cameraAnim, sceneOverride, splatEdit } = splitAnnotationParts(c.annotation);
    // Comment points of interest: reading unifies the `poi` part and the single `hotspot`
    // of earlier comments, one numbered marker in both cases.
    ann.setViewedPoi(readPoiPoints(c.annotation));
    // Layout mode: attached camera animation → replayed by the viewer (3D/splat).
    ann.setViewedCameraAnim(cameraAnim);
    // Attached 3D scene proposal (46.D): replayed for this comment only. Its twin
    // for the point cloud (batch 14) follows the same rule, read here and replayed by the splat viewer.
    ann.setViewedSceneOverride(sceneOverride);
    // The two binaries of the point-cloud proposal are attachments OF THIS comment:
    // their presigned URLs are read there and nowhere else. A foreign key slipped
    // into the part therefore yields nothing to replay.
    ann.setViewedSplatEdit(resolveSplatEditProposal(splatEdit, c.attachments));
    if (shapes.length > 0) {
      ann.setAnnotating(false);
      ann.setViewed(shapes as unknown as Shape[]);
    } else ann.setViewed(null);
    // Brush strokes: rendered in the scene for this comment, model and point cloud alike
    // (batch 13). The id is only passed if the viewer is its author: that is what the
    // eraser may rewrite.
    if (spatialMedia) paint.showFromAnnotation(c.annotation, c.author?.id === userId ? c.id : null);
    // Captured ratio (3D: cameraState.aspect) to fit the overlay
    const cam = c.cameraState as { aspect?: number } | null;
    ann.setViewedAspect(cam?.aspect ?? null);
    if (c.timestamp != null) {
      // Paused: the annotation is aligned to this frame; playback would hide it immediately.
      videoRef.current?.pause();
      seek(c.timestamp);
    }
    if (c.cameraState != null) {
      if (data?.media.kind === 'SPLAT') splat.restoreCamera(c.cameraState);
      else model3d.restoreCamera(c.cameraState);
    }
  };

  // Deep link (32.E): `?frame=`/`?comment=` applied once on arrival.
  useDeepLink({ data, comments, videoRef, programmaticSeekRef, fallbackFps: fpsOverride, selectComment });

  // Automatic editing (45): with `?timeline=`, the end of a shot chains into the next one.
  useTimelineChain(id, videoRef);

  // Live review room (33.B): driver → broadcast; viewers → apply
  // (playhead, navigation, 3D camera + splat DoF, A/B comparison, image zoom/pan).
  const imageViewApiRef = useRef<ImageViewApi | null>(null);
  const live = useLiveSession({
    mediaId: id,
    kind: data?.media.kind,
    fps: data?.fps ?? fpsOverride,
    syncHz: data?.liveSyncHz ?? 2,
    videoRef,
    programmaticSeekRef,
    captureCamera: () => (data?.media.kind === 'SPLAT' ? splat.captureCamera() : model3d.captureCamera()),
    restoreCamera: (cam) =>
      data?.media.kind === 'SPLAT' ? splat.restoreCamera(cam) : model3d.restoreCamera(cam),
    compareId: compare.compareId,
    onCompareChange: compare.setCompareId,
    compareMode: compare.compareMode,
    onCompareModeChange: compare.setCompareMode,
    wipe: compare.wipe,
    onWipeApply: compare.applyWipe,
    imageViewApiRef,
  });

  // Wipe bar: lifted state + co-pilot takeover as soon as the handle is grabbed.
  const sharedWipe = compare.makeSharedWipe(live.claimInteraction);

  /**
   * Brings the camera back to a point of interest reread (number clicked in the thread). The point is in
   * OBJECT space: framing lands in the same place for every viewer, whatever the
   * media's transform. Same rule as the camera presentation.
   */
  const focusPoi = (point: PoiPoint) => {
    if (data?.media.kind === 'SPLAT') splat.focusPoi(point);
    else if (data?.media.kind === 'MODEL_3D') model3d.focusPoi(point);
  };

  /**
   * Starts/stops annotation.
   *
   * Until now it PLACED a surface point at the center of the viewer on opening, on a 3D model
   * as on a splat: a point nobody had designated joined the comment at
   * every toggle. Points are now placed where you click, with the rail tool;
   * entering annotation mode no longer creates any.
   */
  const toggleAnnotating = () => {
    ann.setAnnotating((prev) => {
      const next = !prev;
      if (next) clearSelection();
      return next;
    });
  };

  // M shortcut: pause + focus the composer (comment at the current frame).
  const openComposer = useCallback(() => {
    setCommentsOpen(true);
    setTimeout(() => composerRef.current?.focus(), 0);
  }, []);

  const submitComment = useSubmitComment({
    id,
    data,
    ann,
    paint,
    videoRef,
    captureCamera: () => (data?.media.kind === 'SPLAT' ? splat.captureCamera() : model3d.captureCamera()),
    loadComments,
    loop,
    fps: data?.fps ?? fpsOverride,
  });

  // Publishing freezes the scene: unsaved 3D staging first becomes the base
  // override (46.S), so what the manager sees is what reviewers see by default.
  const publishSceneFirst = usePublishSceneOverride(id, data, ann);

  // Publish + conversion restart (excerpt, 300-line budget).
  const { reprocessing, publishMedia, reprocessMedia } = useMediaActions(id, model3d, publishSceneFirst);

  const kind = data?.media.kind;
  /*
   * One cadence for the whole screen.
   *
   * The page distributed the raw database value (23.98, rounded to the hundredth) to the
   * comments panel, annotation ranges and deep links, while the viewer recomputed the exact
   * fraction (23.976) for its counter and timeline. The two diverge by one frame every four minutes:
   * the same frame carried two different numbers on the same screen, and copying a link to a frame
   * then opening it did not show the same image.
   */
  const fps = data?.fps != null ? exactFrameRate(data.fps) : fpsOverride;
  const startFrame = data?.startFrame ?? 1001;

  // Timeline markers (34.C) as separators in the comment thread (feedback 34),
  // same query as the player (shared cache), disabled outside video (mediaId 0).
  const markersApi = useTimelineMarkers(kind === 'VIDEO' ? id : 0);

  // prettier-ignore
  const rootClass = theater ? 'fixed inset-0 z-40 bg-background p-4'
    : isFullscreen ? 'h-screen bg-background p-4' : 'min-h-0 flex-1 p-4';

  // Slots of the single header: identity, actions, comments, and the flag
  // saying whether the viewer chrome hosts them or the page must render them itself.
  const {
    hosted,
    identity,
    actions,
    comments: commentsColumn,
  } = useReviewHeaderSlots({
    id,
    data,
    kind,
    theater,
    compare,
    live,
    commentsOpen,
    setCommentsOpen,
    setTheater,
    onPublish: publishMedia,
    onPictureInPicture: togglePictureInPicture,
    comments,
    userId,
    role,
    loadComments,
    fps,
    startFrame,
    selectedCommentId,
    selectComment,
    markersApi,
    seek,
    composerRef,
    ann,
    loop,
    submitComment,
    toggleAnnotating,
    onPoiFocus: focusPoi,
  });

  return (
    <PageShell
      title={data?.media.originalName ?? 'Review'}
      breadcrumb={<EntityBreadcrumb entity="media" id={id} />}
      width="flush"
    >
      {/* The native menu is blocked globally by ContextMenuGuard (A3): the review no longer
          has to mark the event as handled, which made silent every area without a
          business menu: header, options bar, dock, transport, comments panel. */}
      <ReviewHeaderSlotsContext.Provider
        value={hosted ? { identity, actions, comments: commentsColumn } : null}
      >
        <div ref={reviewRootRef} className={`flex flex-col ${rootClass}`}>
          {theater && <TheaterExitButton onExit={() => setTheater(false)} />}
          <ReviewPageHeader
            hosted={hosted}
            theater={theater}
            hasData={!!data}
            hasError={!!error}
            identity={identity}
            actions={actions}
          />
          {error && <p className="mb-2 shrink-0 text-sm text-destructive">{error}</p>}

          {/* Body: viewer (large) + comments when the chrome does not host them */}
          <div className="flex min-h-0 flex-1 gap-4">
            {/* Last-resort boundary: the chrome places one flush with the viewport, which
                keeps the header and comments standing when the view falls over. This one
                only serves in case the branch itself throws. */}
            <ErrorBoundary scope="viewer">
              <ReviewViewer
                data={data}
                error={error}
                ann={ann}
                model3d={model3d}
                splat={splat}
                paint={paint}
                videoRef={videoRef}
                programmaticSeekRef={programmaticSeekRef}
                comments={comments}
                selectedCommentId={selectedCommentId}
                fps={fps}
                setFpsOverride={setFpsOverride}
                reprocessing={reprocessing}
                role={role}
                canEditTransform={canEditTransform}
                canEditSplat={canEditSplat}
                canManage={canManageMedia}
                onSplatEditsSaved={onSplatEditsSaved}
                onClearSelection={clearSelection}
                onSelectComment={selectComment}
                onManualSeek={clearSelection}
                onMarker={openComposer}
                onReprocess={reprocessMedia}
                onToggleAnnotate={toggleAnnotating}
                onFullscreen={toggleFullscreen}
                compareIds={compare.compareIds}
                onCloseCompare={() => compare.setCompareId(null)}
                onRemoveCompare={compare.removeCompareId}
                onSetCompare={compare.setCompareId}
                compareMode={compare.compareMode}
                onCompareModeChange={compare.setCompareMode}
                sharedWipe={sharedWipe}
                imageViewApiRef={imageViewApiRef}
                onImageUserView={live.claimInteraction}
                onLoopChange={setLoop}
              />
            </ErrorBoundary>

            {!hosted && commentsColumn}
          </div>
        </div>
      </ReviewHeaderSlotsContext.Provider>
    </PageShell>
  );
}
