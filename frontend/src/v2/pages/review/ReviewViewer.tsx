// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { type ComponentProps } from 'react';
import type { ReviewComment, Role } from '../../types/api';
import { useAuth } from '../../stores/useAuth';
import { useWatermarkConfigQuery } from '../../lib/queries';
import WatermarkOverlay from '../../components/WatermarkOverlay';
import ImageReviewViewer from '../../components/ImageReviewViewer';
import { Skeleton } from '../../components/ui/skeleton';
import { resolveGlbSrc, type MediaResp, type SplatEditsPatch } from './reviewTypes';
import { exactFrameRate } from './frameRate';
import { hlsMasterUrl } from './videoSource';
import { useMediaExport } from './useMediaExport';
import { useAnnotationOverlay, useHotspotDisplay } from './useAnnotationOverlay';
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
import MediaChrome from './MediaChrome';
import ImageReviewSection from './ImageReviewSection';
import { intlLocale } from '../../i18n';

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
  fps: storedFps,
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
  onClearSelection: (opts?: { keepScene?: boolean }) => void;
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
  // Zoom/pan répliqué entre panes A/B image (34.D) — relais bidirectionnel.
  const imageSync = useImageCompareSync(imageViewApiRef);
  // HLS adaptatif (Phase 23) : master servi par le proxy auth quand des renditions existent
  // **et** que le média n'est pas coupé — le master ignore le trim (cf. videoSource.ts).
  const hlsUrl = data ? hlsMasterUrl(data.media.id, data) : null;
  const startFrame = data?.startFrame ?? 1001;
  // Cadence de diffusion : la base ne range qu'un arrondi au centième (23.98 pour
  // 24000/1001), dont tous les numéros de frame dérivent. On la corrige ici, à l'entrée du
  // viewer, pour que le compteur, la timeline et les marqueurs comptent les mêmes images
  // que le DCC de l'artiste (cf. frameRate.ts). La cadence saisie à la main, elle, reste
  // telle quelle : c'est une valeur que l'utilisateur est en train d'écrire, pas un relevé.
  const fps = data?.fps != null ? exactFrameRate(data.fps) : storedFps;
  // Exports du dock (frame courante en PNG, planche contact) — les deux boutons du panneau
  // « Export » n'étaient rendus que si on leur passait leurs actions.
  const mediaExport = useMediaExport(data, videoRef);
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
      ? `${wmUser.name ?? wmUser.email} — ${new Date().toLocaleDateString(intlLocale())}`
      : null;

  // Un déplacement de la vue 3D/splat (orbite, vol, zoom) masque l'annotation du commentaire
  // sélectionné (elle n'a de sens que depuis la caméra d'origine). Vidéo : idem via seek/lecture
  // ; image : annotations ancrées au pixel, conservées au zoom/pan.
  const clearOnViewMove = () => {
    if ((kind === 'MODEL_3D' || kind === 'SPLAT') && (selectedCommentId != null || ann.viewed))
      // La proposition de scène 3D d'un commentaire reste appliquée (46.T) : on peut naviguer
      // dans la scène modifiée ; Échap ou le bouton du viewer la relâchent.
      onClearSelection({ keepScene: kind === 'MODEL_3D' });
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
        <MediaChrome
          kind="VIDEO"
          data={data}
          fps={fps}
          ann={ann}
          role={role}
          canEdit={canEdit}
          videoRef={videoRef}
          onSaved={onSplatEditsSaved}
          onExportFrame={mediaExport.onExportFrame}
          onContactSheet={mediaExport.onContactSheet}
          compare={{
            mode: compareMode,
            onMode: onCompareModeChange,
            ids: compareIds,
            onClear: closeCompare,
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
          onFullscreen={onFullscreen}
          onToggleAnnotate={onToggleAnnotate}
          onClearSelection={onClearSelection}
          onSaved={onSplatEditsSaved}
          compareIds={compareIds}
          compareMode={compareMode}
          onCompareModeChange={onCompareModeChange}
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
          overlay={renderOverlay(ann.viewedAspect ?? undefined)}
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

      {/* Les assets de la version vivent dans le tiroir « pellicule » du chrome (D1) :
          ils étaient rendus ici *et* là, deux fois sur le même écran. */}
    </section>
  );
}
