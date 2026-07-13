import { type ComponentProps, useEffect, useState } from 'react';
import type { ReviewComment, Role } from '../../types/api';
import { AnnotationCanvas } from '../../components/AnnotationCanvas';
import ImageReviewViewer from '../../components/ImageReviewViewer';
import { Skeleton } from '../../components/ui/skeleton';
import { resolveGlbSrc, VIEWER_ZONE, type MediaResp, type SplatEditsPatch } from './reviewTypes';
import type { useAnnotations } from './useAnnotations';
import type { useModel3DThree } from './three/useModel3DThree';
import type { SplatPaintState } from './splat/paint/useSplatPaint';
import type { SplatViewer } from './splat/useSplat';
import ReviewAnnotationBar from './ReviewAnnotationBar';
import Filmstrip from './Filmstrip';
import Model3DReview from './Model3DReview';
import SplatReview from './splat/SplatReview';
import VideoComparePane from './VideoComparePane';
import VideoWipeOverlay from './VideoWipeOverlay';
import VideoPane from './VideoPane';
import VideoTrimBar from './VideoTrimBar';

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
  paint,
  videoRef,
  programmaticSeekRef,
  comments,
  selectedCommentId,
  fps,
  setFpsOverride,
  reprocessing,
  role,
  canEditTransform,
  canEdit,
  canManage,
  onToggleAnnotating,
  onClearSelection,
  onPlaceHotspot,
  onSelectComment,
  onManualSeek,
  onMarker,
  onReprocess,
  onSplatEditsSaved,
  compareId,
  onCloseCompare,
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
  /** Édition du média (trim, éditeur splat) — faux dès que le média est publié (Phase 11). */
  canEdit: boolean;
  /** Gestion du média (présentation/mise en scène) — reste vrai après publication. */
  canManage: boolean;
  onToggleAnnotating: () => void;
  onClearSelection: () => void;
  onPlaceHotspot: () => void;
  onSelectComment: (c: ReviewComment) => void;
  onManualSeek: () => void;
  onMarker: () => void;
  onReprocess: () => void;
  onSplatEditsSaved: (patch: SplatEditsPatch) => void;
  compareId: number | null;
  onCloseCompare: () => void;
}) {
  const kind = data?.media.kind;
  const src = data?.proxyUrl ?? data?.url;
  const startFrame = data?.startFrame ?? 1001;
  const glbSrc = resolveGlbSrc(data);
  const model3dReady =
    kind === 'MODEL_3D' && data?.media.status !== 'PROCESSING' && !!glbSrc && !model3d.loadError;
  const splatReady = kind === 'SPLAT' && data?.media.status === 'READY' && splat.ready && !splat.loadError;
  // Verrou de publication (Phase 11) : les outils d'édition disparaissent dès la publication
  // (le backend refuse de toute façon en 403) ; la présentation reste pilotable (canManage).
  const showEditTools = canEditTransform;
  const showSplatEdit = splatReady && canEdit;
  // Comparaison A/B vidéo : côte-à-côte ou wipe (14.C).
  const [compareMode, setCompareMode] = useState<'side' | 'wipe'>('side');
  const closeCompare = () => {
    setCompareMode('side');
    onCloseCompare();
  };

  // Hotspot du splat (10.G) : affiche celui du commentaire sélectionné, sinon celui en cours
  // de placement. Le marqueur est projeté à l'écran par le viewer (useSplat).
  const { showHotspot } = splat;
  const splatHotspot = kind === 'SPLAT' ? (ann.viewed3d ?? ann.hotspot3d) : null;
  useEffect(() => {
    if (kind === 'SPLAT') showHotspot(splatHotspot);
  }, [kind, splatHotspot, showHotspot]);

  // Hotspot du modèle 3D (Three) : même logique que le splat — marqueur projeté par le viewer.
  const { showHotspot: showModelHotspot } = model3d;
  const model3dHotspot = kind === 'MODEL_3D' ? (ann.viewed3d ?? ann.hotspot3d) : null;
  useEffect(() => {
    if (kind === 'MODEL_3D') showModelHotspot(model3dHotspot);
  }, [kind, model3dHotspot, showModelHotspot]);

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
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <VideoPane
              src={src}
              videoRef={videoRef}
              programmaticSeekRef={programmaticSeekRef}
              overlay={renderOverlay()}
              compareOverlay={
                compareId != null && compareMode === 'wipe' ? (
                  <VideoWipeOverlay
                    compareId={compareId}
                    masterRef={videoRef}
                    onClose={closeCompare}
                    onSide={() => setCompareMode('side')}
                  />
                ) : null
              }
              comments={comments ?? []}
              selectedId={selectedCommentId}
              onSelectComment={onSelectComment}
              onManualSeek={onManualSeek}
              onMarker={onMarker}
              fps={fps}
              fpsDetected={data?.fps != null}
              setFpsOverride={setFpsOverride}
              startFrame={startFrame}
              trimRange={
                // Le proxy trimé actif redémarre à 0 : l'ombrage ne vaut que sur la vidéo complète.
                data?.trim && !data.trimProxyReady
                  ? { start: data.trim.inFrame / fps, end: data.trim.outFrame / fps }
                  : null
              }
            />
            {data && canEdit && (
              <VideoTrimBar data={data} fps={fps} videoRef={videoRef} onSaved={onSplatEditsSaved} />
            )}
          </div>
          {/* Comparaison A/B côte à côte : pane B synchronisé sur le lecteur maître. */}
          {compareId != null && compareMode === 'side' && (
            <VideoComparePane
              compareId={compareId}
              masterRef={videoRef}
              onClose={closeCompare}
              onWipe={() => setCompareMode('wipe')}
            />
          )}
        </div>
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
              info={{ format: data.media.originalName.split('.').pop()?.toUpperCase() ?? null }}
            />
          </div>
        </div>
      )}

      {kind === 'MODEL_3D' && data && (
        <Model3DReview
          data={data}
          model3d={model3d}
          ann={ann}
          canManage={canManage}
          showEditTools={showEditTools}
          role={role}
          reprocessing={reprocessing}
          onReprocess={onReprocess}
          onSaved={onSplatEditsSaved}
          overlay={renderOverlay(ann.viewedAspect ?? undefined)}
          ready={model3dReady}
        />
      )}

      {kind === 'SPLAT' && data && (
        <SplatReview
          data={data}
          splat={splat}
          showEdit={showSplatEdit}
          canPresent={splatReady && canManage}
          paint={paint}
          onSaved={onSplatEditsSaved}
          overlay={renderOverlay()}
          ann={ann}
        />
      )}

      {/* Filmstrip généralisé : médias de la version courante, tous types (14.E) */}
      {data && <Filmstrip versionId={data.media.versionId} mediaId={data.media.id} />}
    </section>
  );
}
