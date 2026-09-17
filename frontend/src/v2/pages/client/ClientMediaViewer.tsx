// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { clientApi } from './clientApi';
import ClientAnnotationBar from './ClientAnnotationBar';
import ClientComments from './ClientComments';
import ClientImageView from './ClientImageView';
import ClientModel3DView from './ClientModel3DView';
import ClientSplatView from './ClientSplatView';
import ClientUnavailable from './ClientUnavailable';
import ClientVideoPlayer from './ClientVideoPlayer';
import { useClientSubmitComment } from './useClientSubmitComment';
import { mediaTimeOf, playerTimeOf, toPlayerComments } from './clientViewerModel';
import type { ClientMediaSource } from './clientTypes';
import WatermarkOverlay from '../../components/WatermarkOverlay';
import ReviewAnnotationBar from '../review/ReviewAnnotationBar';
import { useAnnotations } from '../review/useAnnotations';
import { useAnnotationOverlay } from '../review/useAnnotationOverlay';
import { splitAnnotationParts, VIEWER_ZONE } from '../review/reviewTypes';
import type { Shape } from '../../components/AnnotationCanvas';
import type { ClientComment, ClientMedia } from '../../types/api';
import { useT } from '../../i18n';

/** Cadence de repli quand le partage n'annonce pas celle du média. */
const FALLBACK_FPS = 24;
/** Première frame de repli — même convention que le backend (`project.startFrame`). */
const FALLBACK_START_FRAME = 1001;

/**
 * Viewer de la page client (35.D) — **les quatre types de médias**, et désormais les outils
 * de dessin sur les quatre.
 *
 * L'annotation n'est pas réécrite pour l'invité : ce sont `AnnotationCanvas`,
 * `useAnnotations` et `useAnnotationOverlay` de la review interne, qui ne dépendent ni d'un
 * compte ni d'une requête authentifiée. Le dessin part avec le commentaire, dans le format
 * que la review relit — c'est ce qui permet à l'artiste de rouvrir le retour du client et de
 * tomber sur la bonne frame, avec le trait au bon endroit.
 *
 * Le filigrane par spectateur (35.B) couvre les quatre types, overlay compris.
 */
export default function ClientMediaViewer({
  token,
  media,
  canComment,
  watermarkText,
  watermarkOpacity,
  onBack,
}: {
  token: string;
  media: ClientMedia;
  canComment: boolean;
  watermarkText: string | null;
  watermarkOpacity: number;
  onBack: () => void;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [fpsOverride, setFpsOverride] = useState<number | null>(null);
  const ann = useAnnotations();
  const overlay = useAnnotationOverlay(ann);

  const sourceQ = useQuery({
    queryKey: ['client-share', token, 'media', media.id, 'url'],
    queryFn: () => clientApi.get<ClientMediaSource>(token, `/media/${media.id}/url`),
    staleTime: 5 * 60 * 1000,
  });
  const source = sourceQ.data;
  // Slate en tête du dérivé client (35.A) : les timestamps de commentaires restent exprimés
  // dans le référentiel du média — on décale à l'affichage, au seek et à l'envoi.
  const slateSec = source?.slateSec ?? 0;

  const commentsQ = useQuery({
    queryKey: ['client-share', token, 'media', media.id, 'comments'],
    queryFn: () => clientApi.get<{ comments: ClientComment[] }>(token, `/media/${media.id}/comments`),
  });
  const comments = useMemo(() => commentsQ.data?.comments ?? [], [commentsQ.data]);
  const playerComments = useMemo(() => toPlayerComments(comments, slateSec), [comments, slateSec]);

  const isVideo = media.kind === 'VIDEO';
  const fps = fpsOverride ?? source?.fps ?? FALLBACK_FPS;

  const seekMedia = useCallback(
    (mediaSeconds: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = playerTimeOf(mediaSeconds, slateSec);
      void v.play().catch(() => undefined);
    },
    [slateSec],
  );

  /**
   * Sélection d'un commentaire : on rejoue ensemble le seek et le dessin. La lecture
   * masquerait aussitôt l'annotation, qui est alignée sur UNE frame — on met donc en pause,
   * comme la review interne.
   */
  const selectComment = useCallback(
    (comment: { id: number; timestamp: number | null; annotation?: unknown }) => {
      setSelectedId(comment.id);
      const { shapes } = splitAnnotationParts(comment.annotation);
      ann.setAnnotating(false);
      ann.setViewed(shapes.length > 0 ? (shapes as Shape[]) : null);
      if (comment.timestamp != null && videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = playerTimeOf(mediaTimeOf(comment.timestamp, slateSec), slateSec);
      }
    },
    [ann, slateSec],
  );

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    ann.clearViewed();
  }, [ann]);

  const submitComment = useClientSubmitComment({
    token,
    mediaId: media.id,
    isVideo,
    slateSec,
    videoRef,
    ann,
  });

  const watermark = watermarkText ? (
    <WatermarkOverlay text={watermarkText} opacity={watermarkOpacity} />
  ) : null;
  const loading = sourceQ.isPending;
  // Le dessin est ouvert dès que le lien autorise les retours : un lien en lecture seule ne
  // propose pas d'outil, il n'aurait nulle part où l'envoyer.
  const canAnnotate = canComment;
  const drawOverlay = overlay();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        <button
          onClick={onBack}
          className="mb-3 flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={15} /> {t('versions.allMedia')}
        </button>

        {canAnnotate && (
          <div className="mb-2">
            <ClientAnnotationBar ann={ann} />
          </div>
        )}

        <div className="relative flex min-h-0 flex-1 flex-col">
          {media.kind === 'MODEL_3D' ? (
            <ClientModel3DView
              source={source}
              loading={loading}
              watermark={watermark}
              overlay={drawOverlay}
            />
          ) : media.kind === 'SPLAT' ? (
            <ClientSplatView
              source={source}
              originalName={media.originalName}
              loading={loading}
              watermark={watermark}
              overlay={drawOverlay}
            />
          ) : isVideo ? (
            source ? (
              <ClientVideoPlayer
                src={source.url}
                videoRef={videoRef}
                comments={playerComments}
                selectedId={selectedId}
                onSelectComment={selectComment}
                onMarker={() => composerRef.current?.focus()}
                fps={fps}
                fpsDetected={source.fps != null}
                setFpsOverride={setFpsOverride}
                startFrame={source.startFrame ?? FALLBACK_START_FRAME}
                watermark={watermark}
                overlay={drawOverlay}
              />
            ) : (
              <div className={VIEWER_ZONE}>
                {sourceQ.error ? (
                  <ClientUnavailable />
                ) : (
                  <p className="p-10 text-sm text-muted-foreground">{t('common.loading')}</p>
                )}
                {watermark}
              </div>
            )
          ) : (
            <ClientImageView
              src={source?.url ?? null}
              alt={media.originalName}
              ann={ann}
              canAnnotate={canAnnotate}
              failed={!!sourceQ.error}
              loading={loading}
              watermark={watermark}
            />
          )}
          {/* Pilule « Masquer l'annotation » — la même qu'en review, Échap compris. */}
          <ReviewAnnotationBar ann={ann} onClearSelection={clearSelection} />
        </div>

        <p className="mt-2 truncate text-sm text-muted-foreground">{media.originalName}</p>
      </div>

      <ClientComments
        comments={comments}
        canComment={canComment}
        timed={isVideo}
        fps={fps}
        startFrame={source?.startFrame ?? FALLBACK_START_FRAME}
        selectedId={selectedId}
        onSelect={selectComment}
        onSeek={seekMedia}
        onSubmit={submitComment}
        composerRef={composerRef}
      />
    </div>
  );
}
