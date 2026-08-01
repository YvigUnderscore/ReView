import { type ComponentProps } from 'react';
import type { ReviewComment, Role } from '../../types/api';
import { useAuth } from '../../stores/useAuth';
import { useWatermarkConfigQuery } from '../../lib/queries';
import WatermarkOverlay from '../../components/WatermarkOverlay';
import ImageReviewViewer from '../../components/ImageReviewViewer';
import ReviewCanvasRefs, { ReviewCanvasRefsControls } from './ReviewCanvasRefs';
import { Skeleton } from '../../components/ui/skeleton';
import { resolveGlbSrc, VIEWER_ZONE, type MediaResp, type SplatEditsPatch } from './reviewTypes';
import { useAnnotationOverlay, useHotspotDisplay } from './useAnnotationOverlay';
import { useImageCompareSync } from './useImageCompareSync';
import type { CompareMode } from './useCompareState';
import type { useAnnotations } from './useAnnotations';
import type { useModel3DThree } from './three/useModel3DThree';
import type { SplatPaintState } from './splat/paint/useSplatPaint';
import type { SplatViewer } from './splat/useSplat';
import ReviewAnnotationBar from './ReviewAnnotationBar';
import ReviewContextMenu from './ReviewContextMenu';
import Filmstrip from './Filmstrip';
import ImageComparePane from './ImageComparePane';
import ImageWipeOverlay from './ImageWipeOverlay';
import { ImageDiffOverlay } from './DiffOverlay';
import Model3DReview from './Model3DReview';
import SplatReview from './splat/SplatReview';
import VideoWipeOverlay from './VideoWipeOverlay';
import VideoPane from './VideoPane';
import VideoReviewSection from './VideoReviewSection';

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
  compareIds,
  onCloseCompare,
  onRemoveCompare,
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
  /** Médias B (34.D) : 1 = A/B classique (side/wipe) ; 2-3 = grille 2×2 vidéo. */
  compareIds: number[];
  onCloseCompare: () => void;
  /** Retire un seul pane de la grille (croix d'une case). */
  onRemoveCompare: (mediaId: number) => void;
  /** Mode de comparaison hissé (répliqué en session live, retours 33 ; diff 34.E). */
  compareMode: CompareMode;
  onCompareModeChange: (mode: CompareMode) => void;
  /** Position/angle du wipe hissés (répliqués en session live). */
  sharedWipe?: ComponentProps<typeof VideoWipeOverlay>['sharedWipe'];
  /** Vue image partagée en session live (capture/application) + prise de main sur zoom/pan. */
  imageViewApiRef?: ComponentProps<typeof ImageReviewViewer>['viewApiRef'];
  onImageUserView?: () => void;
  /** Boucle I/O remontée (34.A) — plage in→out du prochain commentaire. */
  onLoopChange?: ComponentProps<typeof VideoPane>['onLoopChange'];
}) {
  const kind = data?.media.kind;
  const src = data?.proxyUrl ?? data?.url;
  const compareId = compareIds[0] ?? null;
  // Zoom/pan répliqué entre panes A/B image (34.D) — relais bidirectionnel.
  const imageSync = useImageCompareSync(imageViewApiRef);
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

  // Hotspot 3D/splat (10.G, extrait — budget 300) : commentaire sélectionné ou placement.
  useHotspotDisplay(kind, ann, splat, model3d);

  // Overlay d'annotation 2D (extrait — budget 300 lignes).
  const renderOverlay = useAnnotationOverlay(ann);

  // Watermark spectateur interne (35.B, opt-in admin) : identité du compte sur tout le viewer.
  const wmUser = useAuth((s) => s.user);
  const wmQ = useWatermarkConfigQuery();
  const watermarkText =
    wmQ.data?.internal && wmUser
      ? `${wmUser.name ?? wmUser.email} — ${new Date().toLocaleDateString('fr-FR')}`
      : null;

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
      {watermarkText && <WatermarkOverlay text={watermarkText} opacity={wmQ.data?.opacity} />}
      {(kind === 'IMAGE' || kind === 'VIDEO' || model3dReady || splatReady) && (
        <ReviewAnnotationBar ann={ann} onClearSelection={onClearSelection} />
      )}

      {/* Skeleton du viewer pendant le chargement (10.B5) */}
      {!data && !error && <Skeleton className="min-h-0 flex-1 rounded-lg" />}

      {kind === 'VIDEO' && src && data && (
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
          canEdit={canEdit}
          canManage={canManage}
          ann={ann}
          onToggleAnnotate={onToggleAnnotate}
          onClearSelection={onClearSelection}
          onSplatEditsSaved={onSplatEditsSaved}
          compareIds={compareIds}
          compareMode={compareMode}
          onCompareModeChange={onCompareModeChange}
          onRemoveCompare={onRemoveCompare}
          closeCompare={closeCompare}
          sharedWipe={sharedWipe}
        />
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
            onDiff={() => onCompareModeChange('diff')}
            sharedWipe={sharedWipe}
          />
        ) : compareId != null && compareMode === 'diff' ? (
          // Différence amplifiée |A − B| (34.E) — remplace la visionneuse comme le wipe.
          <ImageDiffOverlay
            aUrl={data.url}
            compareId={compareId}
            onClose={closeCompare}
            onSide={() => onCompareModeChange('side')}
            onWipe={() => onCompareModeChange('wipe')}
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
              annShapes={ann.viewed ?? ann.annot}
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
                    onViewChange={compareId != null ? imageSync.onMasterView : undefined}
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
            {/* Comparaison A/B image côte à côte — zoom/pan répliqué (34.D). */}
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
          role={role}
          overlay={renderOverlay()}
          ann={ann}
        />
      )}

      {/* Filmstrip généralisé : médias de la version courante, tous types (14.E) */}
      {data && <Filmstrip versionId={data.media.versionId} mediaId={data.media.id} />}
    </section>
  );
}
