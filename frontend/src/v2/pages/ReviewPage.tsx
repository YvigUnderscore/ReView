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
import { resolveGlbSrc, splitAnnotationParts, type MediaResp } from './review/reviewTypes';
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
import { useReviewHeaderSlots } from './review/header/useReviewHeaderSlots';
import ReviewPageHeader from './review/header/ReviewPageHeader';
import TheaterExitButton from './review/TheaterExitButton';

/** Review d'un média (vidéo/image/3D) — orchestrateur des panes (découpage 10.C2). */
export default function ReviewPage() {
  const { mediaId } = useParams();
  const id = parseIdParam(mediaId);
  // key : réinitialise tout l'état (annotations, sélection, vidéo) au changement de
  // média — navigation précédent/suivant ou changement de version sans quitter l'écran.
  return <ReviewContent key={id} id={id} rawParam={mediaId} />;
}

function ReviewContent({ id, rawParam }: { id: number; rawParam?: string }) {
  const userId = useAuth((s) => s.user?.id) ?? 0;
  const role = useAuth((s) => s.user?.role);

  const qc = useQueryClient();
  const [commentsOpen, setCommentsOpen] = useState(true);
  // Commentaire actuellement affiché (carte mise en avant + annotation visible)
  const [selectedCommentId, setSelectedCommentId] = useState<number | null>(null);
  const [fpsOverride, setFpsOverride] = useState(24);
  // Comparaison A/B + mode + wipe hissés ici pour être répliqués en live (retours 33).
  const compare = useCompareState();
  // Boucle I/O remontée par le lecteur (34.A) : plage in→out du prochain commentaire.
  const [loop, setLoop] = useState<{ in: number | null; out: number | null }>({ in: null, out: null });

  const videoRef = useRef<HTMLVideoElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Drapeau : distingue un seek programmatique d'un déplacement manuel (qui désélectionne).
  const programmaticSeekRef = useRef(false);

  // Modes d'affichage unifiés (plein écran navigateur + théâtre in-window + PiP) : cf. hook.
  // Le bloc review entier (en-tête + viewer + playbar + commentaires) passe en plein écran,
  // pas seulement la zone viewer, pour garder la barre de transport et les commentaires.
  const { reviewRootRef, isFullscreen, toggleFullscreen, theater, setTheater, togglePictureInPicture } =
    useReviewViewport(videoRef);

  // staleTime Infinity : le GET régénère des URLs présignées à chaque appel — un
  // refetch en arrière-plan rechargerait le viewer en pleine lecture. Les mutations
  // (publication, reprocess) invalident explicitement.
  const mediaQ = useQuery({
    queryKey: qk.media(id),
    queryFn: () => api.get<MediaResp>(`/api/media/${id}`),
    staleTime: Infinity,
  });
  const data = mediaQ.data ?? null;
  // URL parlante : `/review/219` → `/review/perso-principal-v01-219` dès le nom connu.
  useCanonicalSlug(rawParam, data ? mediaSlug(data.media.originalName, id) : null);
  const commentsQ = useQuery({
    queryKey: qk.comments(id),
    queryFn: () =>
      api.get<{ items: ReviewComment[] }>(`/api/comments?mediaObjectId=${id}`).then((d) => d.items),
  });
  const comments = commentsQ.data ?? null;
  const error = (mediaQ.error ?? commentsQ.error)?.message ?? null;

  // Couleur d'annotation par utilisateur (14.F) : préférence enregistrée sinon teinte
  // dérivée de l'id (alignée avec les avatars) ; un choix manuel est persisté.
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
    // Brouillon local (32.C) : les formes 2D en cours survivent à un rechargement.
    initialShapes: () => (loadDraft(id)?.shapes as Shape[] | undefined) ?? [],
  });
  useEffect(() => saveDraft(id, { shapes: ann.annot }), [ann.annot, id]);
  const glbSrc = resolveGlbSrc(data);
  const model3d = useModel3DThree(data, glbSrc);
  // Viewer Gaussian Splat (Spark) — monté seulement pour un média SPLAT (10.G).
  const splatUrl = data?.media.kind === 'SPLAT' ? data.url : null;
  const splat = useSplat(splatUrl, data?.media.originalName ?? '', mediaReviewAspect(data).value);
  // Brosse de surface 3D : traits joints au prochain commentaire ; la gomme réécrit ceux
  // d'un commentaire déjà envoyé, d'où l'identifiant du média (invalidation du fil).
  const paint = useSplatPaint(splat, data?.media.kind === 'SPLAT', id);

  const loadComments = useCallback(() => qc.invalidateQueries({ queryKey: qk.comments(id) }), [qc, id]);

  // Verrou de publication (Phase 11, table révisée en Phase 50) : un média publié refuse le
  // montage vidéo et le `transform` d'une version. Restent autorisées les écritures qui ne
  // touchent pas au fichier d'origine — miniature, mise en scène, éditions splat (masque,
  // sous-ensemble) et override USD, toutes rejouées à la lecture.
  const canManageMedia = role === 'ADMIN' || role === 'SUPERVISOR' || data?.media.uploaderId === userId;
  /** Éditions splat : non destructives, donc offertes même après publication. */
  const canEditSplat = canManageMedia;
  /**
   * Transform 3D : le droit vient du SERVEUR (`permissions.editTransform`), plus d'une règle
   * de rôle recopiée ici. L'ancienne — « non publiée + rôle interne » — offrait les gizmos et
   * le bouton « Enregistrer » à un artiste qui n'est pas l'auteur de la version, que
   * `VersionService.update` refuse ensuite en 403. Absent (détail pas encore chargé) : non.
   */
  const canEditTransform = data?.permissions.editTransform ?? false;
  // Miniature auto à la 1re vue (splat + 3D), tous viewers, si absente (Phase 20).
  useAutoThumbnail(id, data, 'SPLAT', splat.ready, splat.captureThumbnail);
  useAutoThumbnail(id, data, 'MODEL_3D', model3d.ready, model3d.captureThumbnail);
  // Patch du cache après enregistrement des éditions splat + recapture gestionnaire (10.F4).
  const onSplatEditsSaved = useSplatThumbnail(id, splat, canEditSplat);

  const seek = (t: number) => {
    if (!videoRef.current) return;
    programmaticSeekRef.current = true;
    videoRef.current.currentTime = t;
  };

  // Désélectionne le commentaire courant et masque toute annotation affichée.
  // `keepScene` (46.T) : un mouvement de vue 3D garde la proposition de scène navigable.
  const clearSelection = (opts?: { keepScene?: boolean }) => {
    setSelectedCommentId(null);
    ann.clearViewed(opts);
    paint.showFromAnnotation(null);
  };

  // Sélection d'un commentaire : restaure ensemble seek + annotation 2D/3D + caméra (animée).
  const selectComment = (c: ReviewComment) => {
    setSelectedCommentId(c.id);
    const { shapes, cameraAnim, sceneOverride } = splitAnnotationParts(c.annotation);
    // Points d'intérêt du commentaire : la lecture unifie la part `poi` et le `hotspot` unique
    // des commentaires antérieurs — une pastille numérotée dans les deux cas.
    ann.setViewedPoi(readPoiPoints(c.annotation));
    // Mode layout : anim caméra jointe → rejouée par le viewer (3D/splat).
    ann.setViewedCameraAnim(cameraAnim);
    // Proposition de scène 3D jointe (46.D) : rejouée pour ce commentaire seulement.
    ann.setViewedSceneOverride(sceneOverride);
    if (shapes.length > 0) {
      ann.setAnnotating(false);
      ann.setViewed(shapes as unknown as Shape[]);
    } else ann.setViewed(null);
    // Traits de la brosse 3D : rendus sur le splat pour ce commentaire. L'identifiant n'est
    // passé que si le spectateur en est l'auteur — c'est ce que la gomme peut réécrire.
    if (data?.media.kind === 'SPLAT')
      paint.showFromAnnotation(c.annotation, c.author?.id === userId ? c.id : null);
    // Ratio capturé (3D: cameraState.aspect) pour caler l'overlay
    const cam = c.cameraState as { aspect?: number } | null;
    ann.setViewedAspect(cam?.aspect ?? null);
    if (c.timestamp != null) {
      // Pause : l'annotation est alignée sur cette frame ; la lecture la masquerait aussitôt.
      videoRef.current?.pause();
      seek(c.timestamp);
    }
    if (c.cameraState != null) {
      if (data?.media.kind === 'SPLAT') splat.restoreCamera(c.cameraState);
      else model3d.restoreCamera(c.cameraState);
    }
  };

  // Lien profond (32.E) : `?frame=`/`?comment=` appliqué une fois à l'arrivée.
  useDeepLink({ data, comments, videoRef, programmaticSeekRef, fallbackFps: fpsOverride, selectComment });

  // Montage automatique (45) : avec `?timeline=`, la fin d'un plan enchaîne sur le suivant.
  useTimelineChain(id, videoRef);

  // Salle de review live (33.B) : driver → diffusion ; spectateurs → application
  // (playhead, navigation, caméra 3D + DoF splat, comparaison A/B, zoom/pan image).
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

  // Barre de wipe : état hissé + prise de main d'un co-pilote dès la poignée saisie.
  const sharedWipe = compare.makeSharedWipe(live.claimInteraction);

  /**
   * Ramène la caméra sur un point d'intérêt relu (numéro cliqué dans le fil). Le point est en
   * espace OBJET : le cadrage retombe au même endroit pour tout spectateur, quelle que soit la
   * transformation du média — même règle que la présentation caméra.
   */
  const focusPoi = (point: PoiPoint) => {
    if (data?.media.kind === 'SPLAT') splat.focusPoi(point);
    else if (data?.media.kind === 'MODEL_3D') model3d.focusPoi(point);
  };

  /**
   * Démarre/arrête l'annotation.
   *
   * Elle POSAIT jusqu'ici un point de surface au centre du viewer à l'ouverture, sur un modèle
   * 3D comme sur un splat : un point que personne n'avait désigné rejoignait le commentaire à
   * chaque bascule. Les points se posent maintenant là où on clique, avec l'outil du rail —
   * entrer en annotation n'en crée plus aucun.
   */
  const toggleAnnotating = () => {
    ann.setAnnotating((prev) => {
      const next = !prev;
      if (next) clearSelection();
      return next;
    });
  };

  // Raccourci M : pause + focus du composer (commentaire à la frame courante).
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

  // Publier fige la scène : la mise en scène 3D non enregistrée devient d'abord l'override de
  // base (46.S) — ce que le gestionnaire voit est ce que les reviewers verront par défaut.
  const publishSceneFirst = usePublishSceneOverride(id, data, ann);

  // Publication + relance de conversion (extrait — budget 300 lignes).
  const { reprocessing, publishMedia, reprocessMedia } = useMediaActions(id, model3d, publishSceneFirst);

  const kind = data?.media.kind;
  /*
   * Une seule cadence pour tout l'écran.
   *
   * La page distribuait la valeur brute de la base — 23.98, l'arrondi au centième — au
   * panneau de commentaires, aux plages d'annotation et aux liens profonds, tandis que le
   * viewer recalculait la fraction exacte (23.976) pour son compteur et sa timeline. Les
   * deux divergent d'une frame toutes les quatre minutes : la même image portait deux
   * numéros différents sur le même écran, et copier un lien vers une frame puis l'ouvrir
   * ne rendait pas la même image.
   */
  const fps = data?.fps != null ? exactFrameRate(data.fps) : fpsOverride;
  const startFrame = data?.startFrame ?? 1001;

  // Marqueurs de timeline (34.C) en séparateurs du fil de commentaires (retours 34) —
  // même query que le lecteur (cache partagé), désactivée hors vidéo (mediaId 0).
  const markersApi = useTimelineMarkers(kind === 'VIDEO' ? id : 0);

  // prettier-ignore
  const rootClass = theater ? 'fixed inset-0 z-40 bg-background p-4'
    : isFullscreen ? 'h-screen bg-background p-4' : 'min-h-0 flex-1 p-4';

  // Emplacements de l'en-tête unique : identité, actions, commentaires — et le drapeau
  // qui dit si le chrome du viewer les héberge ou si la page doit les rendre elle-même.
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
      {/* Le menu natif est bloqué globalement par ContextMenuGuard (A3) : la review n'a plus
          à marquer l'événement comme traité, ce qui rendait muette toute zone dépourvue de
          menu métier — en-tête, barre d'options, dock, transport, panneau de commentaires. */}
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

          {/* Corps : viewer (large) + commentaires quand le chrome ne les héberge pas */}
          <div className="flex min-h-0 flex-1 gap-4">
            {/* Frontière de dernier recours : le chrome en pose une au ras du viewport, qui
                laisse l'en-tête et les commentaires debout quand la vue tombe. Celle-ci ne
                sert plus qu'au cas où la branche elle-même jette. */}
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
