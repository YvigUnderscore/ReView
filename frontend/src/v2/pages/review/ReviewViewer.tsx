import { type ComponentProps, useEffect } from 'react';
import type { ReviewComment, Role } from '../../types/api';
import { AnnotationCanvas } from '../../components/AnnotationCanvas';
import ImageReviewViewer from '../../components/ImageReviewViewer';
import { Skeleton } from '../../components/ui/skeleton';
import { resolveGlbSrc, VIEWER_ZONE, type MediaResp, type SplatTransform } from './reviewTypes';
import type { useAnnotations } from './useAnnotations';
import type { useModel3D } from './useModel3D';
import type { SplatViewer } from './splat/useSplat';
import ReviewAnnotationBar from './ReviewAnnotationBar';
import Model3DPane from './Model3DPane';
import Model3DToolbar from './Model3DToolbar';
import SplatReview from './splat/SplatReview';
import VideoPane from './VideoPane';

/**
 * Zone viewer de la review : barre d'annotation + pane adapté au type de média
 * (vidéo / image / 3D / splat). Extrait de ReviewPage (budget 10.F4). L'orchestrateur
 * garde l'état ; ce composant ne fait que rendre le viewer et l'overlay d'annotation.
 */
export default function ReviewViewer({
  data,
  error,
  ann,
  model3d,
  splat,
  videoRef,
  programmaticSeekRef,
  comments,
  selectedCommentId,
  fps,
  setFpsOverride,
  reprocessing,
  role,
  canEditTransform,
  canManage,
  onToggleAnnotating,
  onClearSelection,
  onPlaceHotspot,
  onSelectComment,
  onManualSeek,
  onMarker,
  onReprocess,
  onSplatTransformSaved,
}: {
  data: MediaResp | null;
  error: string | null;
  ann: ReturnType<typeof useAnnotations>;
  model3d: ReturnType<typeof useModel3D>;
  splat: SplatViewer;
  videoRef: ComponentProps<typeof VideoPane>['videoRef'];
  programmaticSeekRef: ComponentProps<typeof VideoPane>['programmaticSeekRef'];
  comments: ReviewComment[] | null;
  selectedCommentId: number | null;
  fps: number;
  setFpsOverride: (fps: number) => void;
  reprocessing: boolean;
  role?: Role;
  canEditTransform: boolean;
  canManage: boolean;
  onToggleAnnotating: () => void;
  onClearSelection: () => void;
  onPlaceHotspot: () => void;
  onSelectComment: (c: ReviewComment) => void;
  onManualSeek: () => void;
  onMarker: () => void;
  onReprocess: () => void;
  onSplatTransformSaved: (transform: SplatTransform | null) => void;
}) {
  const kind = data?.media.kind;
  const src = data?.proxyUrl ?? data?.url;
  const startFrame = data?.startFrame ?? 1001;
  const glbSrc = resolveGlbSrc(data);
  const model3dReady =
    kind === 'MODEL_3D' && data?.media.status !== 'PROCESSING' && !!glbSrc && !model3d.loadError;
  const splatReady = kind === 'SPLAT' && data?.media.status === 'READY' && splat.ready && !splat.loadError;
  const showEditTools = canEditTransform && !(data?.media.published ?? false);
  // Transformation splat (orientation/échelle) réservée au mode avant-publication (10.G).
  const showSplatEdit = splatReady && canManage && !(data?.media.published ?? false);
  const savedTransform = data?.splatTransform ?? null;

  // Hotspot du splat (10.G) : affiche celui du commentaire sélectionné, sinon celui en cours
  // de placement. Le marqueur est projeté à l'écran par le viewer (useSplat).
  const { showHotspot } = splat;
  const splatHotspot = kind === 'SPLAT' ? (ann.viewed3d ?? ann.hotspot3d) : null;
  useEffect(() => {
    if (kind === 'SPLAT') showHotspot(splatHotspot);
  }, [kind, splatHotspot, showHotspot]);

  // Overlay d'annotation 2D ; `captureAspect` (3D) cale le dessin malgré un viewer de
  // taille différente. Le wrapper est en pointer-events-none : en lecture on peut orbiter
  // (le modèle reçoit les events) ; en édition la SVG les capte.
  const renderOverlay = (captureAspect?: number) =>
    ann.annotating || ann.viewed ? (
      <AnnotationCanvas
        shapes={ann.viewed ?? ann.annot}
        onChange={ann.setShapes}
        editable={ann.annotating && !ann.viewed}
        tool={ann.tool}
        color={ann.color}
        width={ann.penWidth}
        alpha={ann.alpha}
        captureAspect={captureAspect}
      />
    ) : null;

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-2">
      {(kind === 'IMAGE' || kind === 'VIDEO' || model3dReady || splatReady) && (
        <ReviewAnnotationBar
          ann={ann}
          kind={kind}
          onToggle={onToggleAnnotating}
          onClearSelection={onClearSelection}
          onPlaceHotspot={onPlaceHotspot}
        />
      )}

      {/* Skeleton du viewer pendant le chargement (10.B5) */}
      {!data && !error && <Skeleton className="min-h-0 flex-1 rounded-lg" />}

      {kind === 'VIDEO' && src && (
        <VideoPane
          src={src}
          videoRef={videoRef}
          programmaticSeekRef={programmaticSeekRef}
          overlay={renderOverlay()}
          comments={comments ?? []}
          selectedId={selectedCommentId}
          onSelectComment={onSelectComment}
          onManualSeek={onManualSeek}
          onMarker={onMarker}
          fps={fps}
          fpsDetected={data?.fps != null}
          setFpsOverride={setFpsOverride}
          startFrame={startFrame}
        />
      )}

      {kind === 'IMAGE' && data?.url && (
        <div className={VIEWER_ZONE}>
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
            />
          </div>
        </div>
      )}

      {kind === 'MODEL_3D' && data && (
        <>
          <Model3DPane
            status={data.media.status}
            ready={model3dReady}
            glbSrc={glbSrc}
            modelRef={model3d.modelRef}
            transform={model3d.transform}
            freeCamera={model3d.freeCamera}
            hotspots={ann.viewed3d ? [ann.viewed3d] : ann.hotspot3d ? [ann.hotspot3d] : []}
            animationName={model3d.currentAnim ?? undefined}
            overlay={renderOverlay(ann.viewedAspect ?? undefined)}
            canReprocess={role !== 'CLIENT'}
            reprocessing={reprocessing}
            onReprocess={onReprocess}
          />
          {model3dReady && <Model3DToolbar m={model3d} showEditTools={showEditTools} />}
        </>
      )}

      {kind === 'SPLAT' && data && (
        <SplatReview
          data={data}
          splat={splat}
          showEdit={showSplatEdit}
          saved={savedTransform}
          onSaved={onSplatTransformSaved}
          overlay={renderOverlay()}
        />
      )}
    </section>
  );
}
