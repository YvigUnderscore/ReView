import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { mediaSlug, parseIdParam } from '../lib/slug';
import { useCanonicalSlug } from '../lib/useCanonicalSlug';
import { useAuth } from '../stores/useAuth';
import { userColor } from '../lib/userColor';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import type { ReviewComment } from '../types/api';
import { type Shape } from '../components/AnnotationCanvas';
import type { ImageViewApi } from '../components/ImageReviewViewer';
import { Skeleton } from '../components/ui/skeleton';
import { resolveGlbSrc, splitAnnotationParts, type MediaResp } from './review/reviewTypes';
import { useAnnotations } from './review/useAnnotations';
import { loadDraft, saveDraft } from './review/commentDraft';
import { useCompareState } from './review/useCompareState';
import { useDeepLink } from './review/useDeepLink';
import { useLiveSession } from './review/useLiveSession';
import { useMediaActions } from './review/useMediaActions';
import { useSubmitComment } from './review/useSubmitComment';
import { useTimelineMarkers } from './review/useTimelineMarkers';
import { useSplatThumbnail } from './review/useSplatThumbnail';
import { useAutoThumbnail } from './review/useAutoThumbnail';
import { useModel3DThree } from './review/three/useModel3DThree';
import ReviewHeader from './review/ReviewHeader';
import ReviewViewer from './review/ReviewViewer';
import { AnnotationTools } from './review/ReviewAnnotationBar';
import { useSplatPaint } from './review/splat/paint/useSplatPaint';
import { useSplat } from './review/splat/useSplat';
import CommentsPanel from './review/CommentsPanel';

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

  // Plein écran **unifié** : on met tout le bloc review (en-tête + viewer + playbar +
  // commentaires) en plein écran — pas seulement la zone viewer — pour que la barre de
  // transport vidéo reste visible et que le panneau de commentaires soit accessible dans
  // tous les modes (le bouton de bascule de l'en-tête est alors à l'écran).
  const reviewRootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement === reviewRootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void reviewRootRef.current?.requestFullscreen?.();
  }, []);

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
  const splat = useSplat(splatUrl, data?.media.originalName ?? '', data?.splatPresentation?.camera?.aspect);
  // Painter 3D (10.G-V9) : traits de surface joints au prochain commentaire.
  const paint = useSplatPaint(splat, data?.media.kind === 'SPLAT');

  const loadComments = useCallback(() => qc.invalidateQueries({ queryKey: qk.comments(id) }), [qc, id]);

  // Verrou de publication (Phase 11) : un média publié est définitivement figé — tous les
  // outils d'édition (trim, transform, éditeur splat, miniature) sont masqués. Seule la
  // présentation (mise en scène) reste pilotable par les gestionnaires.
  const published = data?.media.published ?? true;
  const canManageMedia = role === 'ADMIN' || role === 'SUPERVISOR' || data?.media.uploaderId === userId;
  const canEditMedia = canManageMedia && !published;
  const canEditTransform = !published && (role === 'ADMIN' || role === 'SUPERVISOR' || role === 'ARTIST');
  // Miniature auto à la 1re vue (splat + 3D), tous viewers, si absente (Phase 20).
  useAutoThumbnail(id, data, 'SPLAT', splat.ready, splat.captureThumbnail);
  useAutoThumbnail(id, data, 'MODEL_3D', model3d.ready, model3d.captureThumbnail);
  // Patch du cache après enregistrement des éditions splat + recapture gestionnaire (10.F4).
  const onSplatEditsSaved = useSplatThumbnail(id, splat, canEditMedia);

  const seek = (t: number) => {
    if (!videoRef.current) return;
    programmaticSeekRef.current = true;
    videoRef.current.currentTime = t;
  };

  // Désélectionne le commentaire courant et masque toute annotation affichée.
  const clearSelection = () => {
    setSelectedCommentId(null);
    ann.clearViewed();
    paint.showFromAnnotation(null);
  };

  // Sélection d'un commentaire : restaure ensemble seek + annotation 2D/3D + caméra (animée).
  const selectComment = (c: ReviewComment) => {
    setSelectedCommentId(c.id);
    const { hotspot, shapes, cameraAnim } = splitAnnotationParts(c.annotation);
    ann.setViewed3d(hotspot);
    // Mode layout : anim caméra jointe → rejouée par le viewer (3D/splat).
    ann.setViewedCameraAnim(cameraAnim);
    if (shapes.length > 0) {
      ann.setAnnotating(false);
      ann.setViewed(shapes as unknown as Shape[]);
    } else ann.setViewed(null);
    // Traits du painter 3D (V9) : rendus sur le splat pour ce commentaire.
    if (data?.media.kind === 'SPLAT') paint.showFromAnnotation(c.annotation);
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

  const placeHotspotCenter = () => {
    const h = data?.media.kind === 'SPLAT' ? splat.raycastCenter() : model3d.hotspotAtCenter();
    if (h) ann.setHotspot3d(h);
  };

  // Démarre/arrête l'annotation. À l'ouverture sur un modèle 3D ou un splat, place un
  // hotspot de surface au centre du viewer (raycast).
  const toggleAnnotating = () => {
    ann.setAnnotating((prev) => {
      const next = !prev;
      if (next) {
        clearSelection();
        const k = data?.media.kind;
        if (k === 'MODEL_3D' || k === 'SPLAT') setTimeout(placeHotspotCenter, 0);
      }
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

  // Publication + relance de conversion (extrait — budget 300 lignes).
  const { reprocessing, publishMedia, reprocessMedia } = useMediaActions(id, model3d);

  const kind = data?.media.kind;
  const fps = data?.fps ?? fpsOverride;
  const startFrame = data?.startFrame ?? 1001;

  // Marqueurs de timeline (34.C) en séparateurs du fil de commentaires (retours 34) —
  // même query que le lecteur (cache partagé), désactivée hors vidéo (mediaId 0).
  const markersApi = useTimelineMarkers(kind === 'VIDEO' ? id : 0);

  return (
    <Shell
      title={data?.media.originalName ?? 'Review'}
      breadcrumb={<EntityBreadcrumb entity="media" id={id} />}
    >
      {/* Clic droit : menu custom des viewers — le menu natif du navigateur est désactivé
          sur toute la review (les viewers 3D/splat utilisent le clic droit pour naviguer). */}
      <div
        ref={reviewRootRef}
        className={`flex flex-col ${isFullscreen ? 'h-screen bg-background p-4' : 'h-[calc(100vh-7rem)]'}`}
        onContextMenu={(e) => e.preventDefault()}
      >
        {data ? (
          <ReviewHeader
            data={data}
            onPublish={publishMedia}
            commentsOpen={commentsOpen}
            onToggleComments={() => setCommentsOpen((o) => !o)}
            compareId={compare.compareId}
            onCompareChange={compare.setCompareId}
            live={live}
          />
        ) : !error ? (
          <div className="mb-3 flex shrink-0 items-center gap-3">
            <Skeleton className="h-7 w-72" />
            <Skeleton className="h-7 w-44" />
          </div>
        ) : null}
        {error && <p className="mb-2 shrink-0 text-sm text-destructive">{error}</p>}

        {/* Corps : viewer (large) + commentaires (panneau) */}
        <div className="flex min-h-0 flex-1 gap-4">
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
            canEdit={canEditMedia}
            canManage={canManageMedia}
            onSplatEditsSaved={onSplatEditsSaved}
            onClearSelection={clearSelection}
            onSelectComment={selectComment}
            onManualSeek={clearSelection}
            onMarker={openComposer}
            onReprocess={reprocessMedia}
            onToggleAnnotate={toggleAnnotating}
            onFullscreen={toggleFullscreen}
            compareId={compare.compareId}
            onCloseCompare={() => compare.setCompareId(null)}
            compareMode={compare.compareMode}
            onCompareModeChange={compare.setCompareMode}
            sharedWipe={sharedWipe}
            imageViewApiRef={imageViewApiRef}
            onImageUserView={live.claimInteraction}
            onLoopChange={setLoop}
          />

          {commentsOpen && (
            <CommentsPanel
              comments={comments}
              mediaObjectId={id}
              currentUserId={userId}
              currentUserRole={role}
              reload={loadComments}
              fps={fps}
              startFrame={startFrame}
              selectedId={selectedCommentId}
              onSelect={selectComment}
              markers={kind === 'VIDEO' ? markersApi.markers : undefined}
              onMarkerSeek={(m) => seek(m.frame / fps)}
              composerRef={composerRef}
              hints={{
                annotation: ann.annot.length > 0,
                hotspot: !!ann.hotspot3d,
                camera: kind === 'MODEL_3D' && ann.annotating,
                references: ann.stagedRefs.length,
                range: kind === 'VIDEO' && loop.in != null && loop.out != null && loop.out > loop.in,
              }}
              onSubmit={submitComment}
              annotating={ann.annotating}
              onToggleAnnotate={toggleAnnotating}
              annotationTools={<AnnotationTools ann={ann} kind={kind} onPlaceHotspot={placeHotspotCenter} />}
            />
          )}
        </div>
      </div>
    </Shell>
  );
}
