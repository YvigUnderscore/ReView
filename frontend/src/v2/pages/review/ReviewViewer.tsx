import { type ComponentProps, useEffect } from 'react';
import type { ReviewComment, Role } from '../../types/api';
import ImageReviewViewer from '../../components/ImageReviewViewer';
import ReviewCanvasRefs, { ReviewCanvasRefsControls } from './ReviewCanvasRefs';
import { Skeleton } from '../../components/ui/skeleton';
import { resolveGlbSrc, VIEWER_ZONE, type MediaResp, type SplatEditsPatch } from './reviewTypes';
import { useAnnotationOverlay } from './useAnnotationOverlay';
import type { useAnnotations } from './useAnnotations';
import type { useModel3DThree } from './three/useModel3DThree';
import type { SplatPaintState } from './splat/paint/useSplatPaint';
import type { SplatViewer } from './splat/useSplat';
import ReviewAnnotationBar from './ReviewAnnotationBar';
import ReviewContextMenu from './ReviewContextMenu';
import Filmstrip from './Filmstrip';
import ImageComparePane from './ImageComparePane';
import ImageWipeOverlay from './ImageWipeOverlay';
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
  onClearSelection,
  onSelectComment,
  onManualSeek,
  onMarker,
  onReprocess,
  onSplatEditsSaved,
  onToggleAnnotate,
  onFullscreen,
  compareId,
  onCloseCompare,
  compareMode,
  onCompareModeChange,
  sharedWipe,
  imageViewApiRef,
  onImageUserView,
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
  onClearSelection: () => void;
  onSelectComment: (c: ReviewComment) => void;
  onManualSeek: () => void;
  onMarker: () => void;
  onReprocess: () => void;
  onSplatEditsSaved: (patch: SplatEditsPatch) => void;
  /** Bascule le mode annotation (menu clic droit). */
  onToggleAnnotate: () => void;
  /** Bascule le plein écran de tout le bloc review (viewer + playbar + commentaires). */
  onFullscreen: () => void;
  compareId: number | null;
  onCloseCompare: () => void;
  /** Mode de comparaison hissé (répliqué en session live, retours 33). */
  compareMode: 'side' | 'wipe';
  onCompareModeChange: (mode: 'side' | 'wipe') => void;
  /** Position/angle du wipe hissés (répliqués en session live). */
  sharedWipe?: ComponentProps<typeof VideoWipeOverlay>['sharedWipe'];
  /** Vue image partagée en session live (capture/application) + prise de main sur zoom/pan. */
  imageViewApiRef?: ComponentProps<typeof ImageReviewViewer>['viewApiRef'];
  onImageUserView?: () => void;
}) {
  const kind = data?.media.kind;
  const src = data?.proxyUrl ?? data?.url;
  // HLS adaptatif (Phase 23) : master servi par le proxy auth quand des renditions existent.
  const hlsUrl = data?.hls ? `/api/media/${data.media.id}/hls/master.m3u8` : null;
  const startFrame = data?.startFrame ?? 1001;
  const model3dReady =
    kind === 'MODEL_3D' && data?.media.status !== 'PROCESSING' && !!resolveGlbSrc(data) && !model3d.loadError;
  const splatReady = kind === 'SPLAT' && data?.media.status === 'READY' && splat.ready && !splat.loadError;
  // Verrou de publication (Phase 11) : les outils d'édition (canEditTransform) disparaissent
  // dès la publication (backend en 403) ; la présentation reste pilotable (canManage).
  // Comparaison A/B : côte-à-côte ou wipe (14.C) — mode hissé (répliqué en live).
  const closeCompare = () => (onCompareModeChange('side'), onCloseCompare());

  // Hotspot 3D/splat (10.G) : affiche celui du commentaire sélectionné, sinon celui en
  // cours de placement — marqueur projeté à l'écran par le viewer concerné.
  const { showHotspot } = splat;
  const { showHotspot: showModelHotspot } = model3d;
  const hotspot3d = kind === 'SPLAT' || kind === 'MODEL_3D' ? (ann.viewed3d ?? ann.hotspot3d) : null;
  useEffect(() => {
    if (kind === 'SPLAT') showHotspot(hotspot3d);
    else if (kind === 'MODEL_3D') showModelHotspot(hotspot3d);
  }, [kind, hotspot3d, showHotspot, showModelHotspot]);

  // Overlay d'annotation 2D (extrait — budget 300 lignes).
  const renderOverlay = useAnnotationOverlay(ann);

  // Un déplacement de la vue 3D/splat (orbite, vol, zoom) masque l'annotation du commentaire
  // sélectionné (elle n'a de sens que depuis la caméra d'origine). Vidéo : idem via seek/lecture
  // ; image : annotations ancrées au pixel, conservées au zoom/pan.
  const clearOnViewMove = () => {
    if ((kind === 'MODEL_3D' || kind === 'SPLAT') && (selectedCommentId != null || ann.viewed))
      onClearSelection();
  };

  return (
    <section
      className="relative flex min-w-0 flex-1 flex-col gap-2"
      onPointerDownCapture={clearOnViewMove}
      onWheelCapture={clearOnViewMove}
    >
      {(kind === 'IMAGE' || kind === 'VIDEO' || model3dReady || splatReady) && (
        <ReviewAnnotationBar ann={ann} onClearSelection={onClearSelection} />
      )}

      {/* Skeleton du viewer pendant le chargement (10.B5) */}
      {!data && !error && <Skeleton className="min-h-0 flex-1 rounded-lg" />}

      {kind === 'VIDEO' && src && data && (
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
          >
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <VideoPane
                src={src}
                hlsUrl={hlsUrl}
                videoRef={videoRef}
                programmaticSeekRef={programmaticSeekRef}
                overlay={renderOverlay()}
                compareOverlay={
                  compareId != null && compareMode === 'wipe' ? (
                    <VideoWipeOverlay
                      compareId={compareId}
                      masterRef={videoRef}
                      onClose={closeCompare}
                      onSide={() => onCompareModeChange('side')}
                      sharedWipe={sharedWipe}
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
                onFullscreen={onFullscreen}
                trimRange={
                  // Le proxy trimé actif redémarre à 0 : l'ombrage ne vaut que sur la vidéo complète.
                  data?.trim && !data.trimProxyReady
                    ? { start: data.trim.inFrame / fps, end: data.trim.outFrame / fps }
                    : null
                }
                timelineSprite={
                  data.timelineSprite && data.timelineSpriteUrl
                    ? { url: data.timelineSpriteUrl, meta: data.timelineSprite }
                    : null
                }
              />
              {data && canEdit && (
                <VideoTrimBar data={data} fps={fps} videoRef={videoRef} onSaved={onSplatEditsSaved} />
              )}
            </div>
          </ReviewContextMenu>
          {/* Comparaison A/B côte à côte : pane B synchronisé sur le lecteur maître. */}
          {compareId != null && compareMode === 'side' && (
            <VideoComparePane
              compareId={compareId}
              masterRef={videoRef}
              onClose={closeCompare}
              onWipe={() => onCompareModeChange('wipe')}
            />
          )}
        </div>
      )}

      {kind === 'IMAGE' &&
        data?.url &&
        (compareId != null && compareMode === 'wipe' ? (
          // Comparaison image en mode wipe : superposition à barre rotative (zoom suspendu).
          <ImageWipeOverlay
            aUrl={data.url}
            aName={data.media.originalName}
            compareId={compareId}
            onClose={closeCompare}
            onSide={() => onCompareModeChange('side')}
            sharedWipe={sharedWipe}
          />
        ) : (
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
            >
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
                    onFullscreen={onFullscreen}
                    viewApiRef={imageViewApiRef}
                    onUserView={onImageUserView}
                    pinned={
                      <ReviewCanvasRefs
                        mediaId={data.media.id}
                        references={data.references ?? []}
                        selectedCommentId={selectedCommentId}
                        canManage={canManage}
                        ann={ann}
                      />
                    }
                  />
                </div>
                <ReviewCanvasRefsControls ann={ann} annotating={ann.annotating} />
              </div>
            </ReviewContextMenu>
            {/* Comparaison A/B image côte à côte */}
            {compareId != null && compareMode === 'side' && (
              <ImageComparePane
                compareId={compareId}
                onClose={closeCompare}
                onWipe={() => onCompareModeChange('wipe')}
              />
            )}
          </div>
        ))}

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
          onFullscreen={onFullscreen}
          overlay={renderOverlay(ann.viewedAspect ?? undefined)}
          ready={model3dReady}
        />
      )}

      {kind === 'SPLAT' && data && (
        <SplatReview
          data={data}
          splat={splat}
          showEdit={splatReady && canEdit}
          canPresent={splatReady && canManage}
          paint={paint}
          onSaved={onSplatEditsSaved}
          onFullscreen={onFullscreen}
          overlay={renderOverlay()}
          ann={ann}
        />
      )}

      {/* Filmstrip généralisé : médias de la version courante, tous types (14.E) */}
      {data && <Filmstrip versionId={data.media.versionId} mediaId={data.media.id} />}
    </section>
  );
}
