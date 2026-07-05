import { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { uploadCommentImages } from '../../lib/commentAttachments';
import { useAuth } from '../stores/useAuth';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import ImageReviewViewer from '../components/ImageReviewViewer';
import type { ReviewComment } from '../types/api';
import { AnnotationCanvas, type Shape } from '../components/AnnotationCanvas';
import { Skeleton } from '../components/ui/skeleton';
import { resolveGlbSrc, VIEWER_ZONE, type MediaResp } from './review/reviewTypes';
import { useAnnotations } from './review/useAnnotations';
import { useModel3D } from './review/useModel3D';
import ReviewHeader from './review/ReviewHeader';
import Model3DPane from './review/Model3DPane';
import Model3DToolbar from './review/Model3DToolbar';
import VideoPane from './review/VideoPane';
import CommentsPanel from './review/CommentsPanel';
import ReviewAnnotationBar from './review/ReviewAnnotationBar';

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

  const loadComments = useCallback(() => qc.invalidateQueries({ queryKey: qk.comments(id) }), [qc, id]);

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
  };

  // Sélection d'un commentaire : restaure ensemble seek + annotation 2D/3D + caméra (animée).
  const selectComment = (c: ReviewComment) => {
    setSelectedCommentId(c.id);
    const a = c.annotation as Array<{ type?: string; position?: string; normal?: string }> | null;
    if (Array.isArray(a)) {
      const hs = a.find((x) => x?.type === 'hotspot');
      const shapes = a.filter((x) => x && (x as { type?: string }).type !== 'hotspot');
      ann.setViewed3d(hs?.position && hs.normal ? { position: hs.position, normal: hs.normal } : null);
      if (shapes.length > 0) {
        ann.setAnnotating(false);
        ann.setViewed(shapes as unknown as Shape[]);
      } else ann.setViewed(null);
    } else {
      ann.setViewed(null);
      ann.setViewed3d(null);
    }
    // Ratio capturé (3D: cameraState.aspect) pour caler l'overlay
    const cam = c.cameraState as { aspect?: number } | null;
    ann.setViewedAspect(cam?.aspect ?? null);
    if (c.timestamp != null) seek(c.timestamp);
    if (c.cameraState != null) model3d.restoreCamera(c.cameraState);
  };

  const placeHotspotCenter = () => {
    const h = model3d.hotspotAtCenter();
    if (h) ann.setHotspot3d(h);
  };

  // Démarre/arrête l'annotation. À l'ouverture sur un modèle 3D, place un hotspot au centre.
  const toggleAnnotating = () => {
    ann.setAnnotating((prev) => {
      const next = !prev;
      if (next) {
        clearSelection();
        if (data?.media.kind === 'MODEL_3D') setTimeout(placeHotspotCenter, 0);
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
    const cameraState = kind === 'MODEL_3D' ? model3d.captureCamera() : undefined;
    // Annotation : 3D = hotspot (au centre) + dessins 2D ; autres = dessins 2D.
    let annotation: unknown;
    if (kind === 'MODEL_3D') {
      const parts: unknown[] = [];
      if (ann.hotspot3d)
        parts.push({ type: 'hotspot', position: ann.hotspot3d.position, normal: ann.hotspot3d.normal });
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
  const src = data?.proxyUrl ?? data?.url;
  const fps = data?.fps ?? fpsOverride;
  const startFrame = data?.startFrame ?? 1001;
  // Outils d'édition 3D masqués une fois publié : le dernier état enregistré (version.transform)
  // reste appliqué au modèle, mais on ne propose plus de le modifier.
  const showEditTools = canEditTransform && !(data?.media.published ?? false);
  const model3dReady =
    kind === 'MODEL_3D' && data?.media.status !== 'PROCESSING' && !!glbSrc && !model3d.loadError;
  // Overlay d'annotation 2D ; `captureAspect` (3D) cale le dessin malgré un viewer
  // de taille différente. Le wrapper est en pointer-events-none : en lecture on peut
  // toujours orbiter (le modèle reçoit les events) ; en édition la SVG les capte.
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
          <section className="flex min-w-0 flex-1 flex-col gap-2">
            {(kind === 'IMAGE' || kind === 'VIDEO' || model3dReady) && (
              <ReviewAnnotationBar
                ann={ann}
                kind={kind}
                onToggle={toggleAnnotating}
                onClearSelection={clearSelection}
                onPlaceHotspot={placeHotspotCenter}
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
                onSelectComment={selectComment}
                onManualSeek={clearSelection}
                onMarker={openComposer}
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
                  onReprocess={reprocessMedia}
                />
                {model3dReady && <Model3DToolbar m={model3d} showEditTools={showEditTools} />}
              </>
            )}
          </section>

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
