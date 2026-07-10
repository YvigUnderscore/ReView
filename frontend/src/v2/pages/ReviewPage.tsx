import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { uploadCommentImages } from '../../lib/commentAttachments';
import { useAuth } from '../stores/useAuth';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import type { ReviewComment } from '../types/api';
import { type Shape } from '../components/AnnotationCanvas';
import { Skeleton } from '../components/ui/skeleton';
import { resolveGlbSrc, type MediaResp, type SplatEditsPatch } from './review/reviewTypes';
import { useAnnotations } from './review/useAnnotations';
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
  const canEditTransform = role === 'ADMIN' || role === 'SUPERVISOR' || role === 'ARTIST';

  const qc = useQueryClient();
  const [commentsOpen, setCommentsOpen] = useState(true);
  // Commentaire actuellement affiché (carte mise en avant + annotation visible)
  const [selectedCommentId, setSelectedCommentId] = useState<number | null>(null);
  const [fpsOverride, setFpsOverride] = useState(24);
  const [reprocessing, setReprocessing] = useState(false);

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

  const ann = useAnnotations();
  const glbSrc = resolveGlbSrc(data);
  const model3d = useModel3D(data, glbSrc);
  // Viewer Gaussian Splat (Spark) — monté seulement pour un média SPLAT (10.G).
  const splatUrl = data?.media.kind === 'SPLAT' ? data.url : null;
  const splat = useSplat(splatUrl, data?.media.originalName ?? '');
  // Painter 3D (10.G-V9) : traits de surface joints au prochain commentaire.
  const paint = useSplatPaint(splat, data?.media.kind === 'SPLAT');

  const loadComments = useCallback(() => qc.invalidateQueries({ queryKey: qk.comments(id) }), [qc, id]);

  // Miniature splat (10.G) : pas de rendu headless serveur → capture client best-effort si
  // absente. Réservée aux gestionnaires du média (le backend re-vérifie via assertMediaManage).
  const canManageMedia = role === 'ADMIN' || role === 'SUPERVISOR' || data?.media.uploaderId === userId;
  const thumbedRef = useRef(false);
  const { ready: splatReadyState, captureThumbnail } = splat;
  useEffect(() => {
    if (
      data?.media.kind !== 'SPLAT' ||
      !splatReadyState ||
      data?.thumbnailUrl ||
      !canManageMedia ||
      thumbedRef.current
    )
      return;
    thumbedRef.current = true;
    const t = setTimeout(async () => {
      const dataUrl = await captureThumbnail();
      if (!dataUrl) return;
      try {
        const { thumbnailUrl } = await api.post<{ thumbnailUrl: string }>(`/api/media/${id}/thumbnail`, {
          dataUrl,
        });
        qc.setQueryData<MediaResp>(qk.media(id), (old) => (old ? { ...old, thumbnailUrl } : old));
      } catch {
        // best-effort : miniature silencieuse (ex. droits insuffisants)
      }
    }, 600);
    return () => clearTimeout(t);
  }, [data, splatReadyState, canManageMedia, captureThumbnail, id, qc]);

  // Éditions splat enregistrées → met à jour le cache média (splatEdits/masque) sans refetch,
  // puis régénère la miniature (le rendu a changé) — best-effort, après stabilisation du rendu.
  const onSplatEditsSaved = useCallback(
    (patch: SplatEditsPatch) => {
      qc.setQueryData<MediaResp>(qk.media(id), (old) => (old ? { ...old, ...patch } : old));
      setTimeout(async () => {
        const dataUrl = await captureThumbnail();
        if (!dataUrl) return;
        try {
          const { thumbnailUrl } = await api.post<{ thumbnailUrl: string }>(`/api/media/${id}/thumbnail`, {
            dataUrl,
          });
          qc.setQueryData<MediaResp>(qk.media(id), (old) => (old ? { ...old, thumbnailUrl } : old));
        } catch {
          // best-effort : miniature silencieuse
        }
      }, 400);
    },
    [qc, id, captureThumbnail],
  );

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
    const a = c.annotation as Array<{ type?: string; position?: string; normal?: string }> | null;
    if (Array.isArray(a)) {
      const hs = a.find((x) => x?.type === 'hotspot');
      // Formes 2D uniquement : les hotspots et traits painter 3D (V9) ont leur propre rendu.
      const shapes = a.filter((x) => {
        const t = x && (x as { type?: string }).type;
        return x && t !== 'hotspot' && t !== 'splat-paint';
      });
      ann.setViewed3d(hs?.position && hs.normal ? { position: hs.position, normal: hs.normal } : null);
      if (shapes.length > 0) {
        ann.setAnnotating(false);
        ann.setViewed(shapes as unknown as Shape[]);
      } else ann.setViewed(null);
    } else {
      ann.setViewed(null);
      ann.setViewed3d(null);
    }
    // Traits du painter 3D (V9) : rendus sur le splat pour ce commentaire.
    if (data?.media.kind === 'SPLAT') paint.showFromAnnotation(a);
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
        parts.push({ type: 'hotspot', position: ann.hotspot3d.position, normal: ann.hotspot3d.normal });
      if (kind === 'SPLAT') parts.push(...paint.serializePending()); // traits du painter (V9)
      parts.push(...ann.annot);
      annotation = parts.length ? parts : undefined;
    } else {
      annotation = ann.annot.length ? ann.annot : undefined;
    }
    try {
      const attachments = files.length > 0 ? await uploadCommentImages(files) : undefined;
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
            canManage={canManageMedia}
            onSplatEditsSaved={onSplatEditsSaved}
            onToggleAnnotating={toggleAnnotating}
            onClearSelection={clearSelection}
            onPlaceHotspot={placeHotspotCenter}
            onSelectComment={selectComment}
            onManualSeek={clearSelection}
            onMarker={openComposer}
            onReprocess={reprocessMedia}
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
