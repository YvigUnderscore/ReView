import { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { uploadCommentAttachments } from '../../lib/commentAttachments';
import { useAuth } from '../stores/useAuth';
import { userColor } from '../lib/userColor';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import type { ReviewComment } from '../types/api';
import { type Shape } from '../components/AnnotationCanvas';
import { Skeleton } from '../components/ui/skeleton';
import { resolveGlbSrc, splitAnnotationParts, type MediaResp } from './review/reviewTypes';
import { useAnnotations } from './review/useAnnotations';
import { useSplatThumbnail } from './review/useSplatThumbnail';
import { useModel3D } from './review/useModel3D';
import ReviewHeader from './review/ReviewHeader';
import ReviewViewer from './review/ReviewViewer';
import { useSplatPaint } from './review/splat/paint/useSplatPaint';
import { useSplat } from './review/splat/useSplat';
import CommentsPanel from './review/CommentsPanel';

/** Review d'un média (vidéo/image/3D) — orchestrateur des panes (découpage 10.C2). */
export default function ReviewPage() {
  const { mediaId } = useParams();
  const id = Number(mediaId);
  // key : réinitialise tout l'état (annotations, sélection, vidéo) au changement de
  // média — navigation précédent/suivant ou changement de version sans quitter l'écran.
  return <ReviewContent key={id} id={id} />;
}

function ReviewContent({ id }: { id: number }) {
  const userId = useAuth((s) => s.user?.id) ?? 0;
  const role = useAuth((s) => s.user?.role);

  const qc = useQueryClient();
  const [commentsOpen, setCommentsOpen] = useState(true);
  // Commentaire actuellement affiché (carte mise en avant + annotation visible)
  const [selectedCommentId, setSelectedCommentId] = useState<number | null>(null);
  const [fpsOverride, setFpsOverride] = useState(24);
  const [reprocessing, setReprocessing] = useState(false);
  // Comparaison A/B vidéo (backlog P2) : média B affiché côte à côte, lecture synchronisée.
  const [compareId, setCompareId] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Drapeau : distingue un seek programmatique d'un déplacement manuel (qui désélectionne).
  const programmaticSeekRef = useRef(false);

  // staleTime Infinity : le GET régénère des URLs présignées à chaque appel — un
  // refetch en arrière-plan rechargerait le viewer en pleine lecture. Les mutations
  // (publication, reprocess) invalident explicitement.
  const mediaQ = useQuery({
    queryKey: qk.media(id),
    queryFn: () => api.get<MediaResp>(`/api/media/${id}`),
    staleTime: Infinity,
  });
  const data = mediaQ.data ?? null;
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
  });
  const glbSrc = resolveGlbSrc(data);
  const model3d = useModel3D(data, glbSrc);
  // Viewer Gaussian Splat (Spark) — monté seulement pour un média SPLAT (10.G).
  const splatUrl = data?.media.kind === 'SPLAT' ? data.url : null;
  const splat = useSplat(splatUrl, data?.media.originalName ?? '');
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
  // Miniature splat + patch du cache après enregistrement des éditions (extrait, budget 10.F4).
  const onSplatEditsSaved = useSplatThumbnail(id, data, splat, canEditMedia);

  const seek = (t: number) => {
    if (videoRef.current) {
      programmaticSeekRef.current = true;
      videoRef.current.currentTime = t;
    }
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
    const { hotspot, shapes } = splitAnnotationParts(c.annotation);
    ann.setViewed3d(hotspot);
    if (shapes.length > 0) {
      ann.setAnnotating(false);
      ann.setViewed(shapes as unknown as Shape[]);
    } else ann.setViewed(null);
    // Traits du painter 3D (V9) : rendus sur le splat pour ce commentaire.
    if (data?.media.kind === 'SPLAT') paint.showFromAnnotation(c.annotation);
    // Ratio capturé (3D: cameraState.aspect) pour caler l'overlay
    const cam = c.cameraState as { aspect?: number } | null;
    ann.setViewedAspect(cam?.aspect ?? null);
    if (c.timestamp != null) seek(c.timestamp);
    if (c.cameraState != null) {
      if (data?.media.kind === 'SPLAT') splat.restoreCamera(c.cameraState);
      else model3d.restoreCamera(c.cameraState);
    }
  };

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

  const submitComment = async (text: string, files: File[]): Promise<boolean> => {
    const kind = data?.media.kind;
    const timestamp = kind === 'VIDEO' && videoRef.current ? videoRef.current.currentTime : undefined;
    const cameraState =
      kind === 'MODEL_3D' ? model3d.captureCamera() : kind === 'SPLAT' ? splat.captureCamera() : undefined;
    // Annotation : 3D/splat = hotspot de surface + dessins 2D ; autres = dessins 2D.
    let annotation: unknown;
    if (kind === 'MODEL_3D' || kind === 'SPLAT') {
      const parts: unknown[] = [];
      if (ann.hotspot3d)
        parts.push({
          type: 'hotspot',
          position: ann.hotspot3d.position,
          normal: ann.hotspot3d.normal,
          space: ann.hotspot3d.space, // espace-objet (splat, V10) — suit la transformation
        });
      if (kind === 'SPLAT') parts.push(...paint.serializePending()); // traits du painter (V9)
      parts.push(...ann.annot);
      annotation = parts.length ? parts : undefined;
    } else {
      annotation = ann.annot.length ? ann.annot : undefined;
    }
    try {
      const attachments = files.length > 0 ? await uploadCommentAttachments(files) : undefined;
      await api.post('/api/comments', {
        mediaObjectId: id,
        content: text || '(image)',
        timestamp,
        cameraState,
        annotation,
        attachments,
      });
      ann.resetComposer();
      paint.clearPending();
      await loadComments();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur à l'envoi du commentaire");
      return false;
    }
  };

  const publishMedia = async () => {
    if (!data) return;
    try {
      const { media } = await api.post<{ media: MediaResp['media'] }>(`/api/media/${id}/publish`);
      // Mise à jour ciblée du cache : pas de refetch (les URLs présignées changeraient
      // et rechargeraient le viewer) — seuls le badge et les brouillons sont concernés.
      qc.setQueryData<MediaResp>(qk.media(id), (old) =>
        old ? { ...old, media: { ...old.media, published: media.published } } : old,
      );
      qc.invalidateQueries({ queryKey: qk.drafts });
      qc.invalidateQueries({ queryKey: ['versions'] });
      toast.success('Média publié pour l’équipe');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur à la publication');
    }
  };

  const reprocessMedia = async () => {
    setReprocessing(true);
    try {
      await api.post(`/api/media/${id}/reprocess`);
      await qc.invalidateQueries({ queryKey: qk.media(id) });
      model3d.clearLoadError();
      toast.success('Conversion relancée');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur à la relance de la conversion');
    } finally {
      setReprocessing(false);
    }
  };

  const kind = data?.media.kind;
  const fps = data?.fps ?? fpsOverride;
  const startFrame = data?.startFrame ?? 1001;

  return (
    <Shell
      title={data?.media.originalName ?? 'Review'}
      breadcrumb={<EntityBreadcrumb entity="media" id={id} />}
    >
      <div className="flex h-[calc(100vh-7rem)] flex-col">
        {data ? (
          <ReviewHeader
            data={data}
            onPublish={publishMedia}
            commentsOpen={commentsOpen}
            onToggleComments={() => setCommentsOpen((o) => !o)}
            compareId={compareId}
            onCompareChange={setCompareId}
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
            onToggleAnnotating={toggleAnnotating}
            onClearSelection={clearSelection}
            onPlaceHotspot={placeHotspotCenter}
            onSelectComment={selectComment}
            onManualSeek={clearSelection}
            onMarker={openComposer}
            onReprocess={reprocessMedia}
            compareId={compareId}
            onCloseCompare={() => setCompareId(null)}
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
              composerRef={composerRef}
              hints={{
                annotation: ann.annot.length > 0,
                hotspot: !!ann.hotspot3d,
                camera: kind === 'MODEL_3D' && ann.annotating,
              }}
              onSubmit={submitComment}
            />
          )}
        </div>
      </div>
    </Shell>
  );
}
