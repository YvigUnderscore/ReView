// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { clientApi } from './clientApi';
import ClientAnnotationBar from './ClientAnnotationBar';
import ClientComments from './ClientComments';
import ClientDecision from './ClientDecision';
import ClientImageView from './ClientImageView';
import ClientModel3DView from './ClientModel3DView';
import ClientSplatView from './ClientSplatView';
import ClientUnavailable from './ClientUnavailable';
import ClientVideoPlayer from './ClientVideoPlayer';
import { useClientSubmitComment } from './useClientSubmitComment';
import { useGuestName } from './useGuestName';
import { mediaTimeOf, playerTimeOf, toPlayerComments } from './clientViewerModel';
import type { ClientMediaSource } from './clientTypes';
import WatermarkOverlay from '../../components/WatermarkOverlay';
import ReviewAnnotationBar from '../review/ReviewAnnotationBar';
import { useAnnotations } from '../review/useAnnotations';
import { useAnnotationOverlay } from '../review/useAnnotationOverlay';
import { splitAnnotationParts, VIEWER_ZONE } from '../review/reviewTypes';
import type { Shape } from '../../components/AnnotationCanvas';
import type { ClientComment, ClientMedia, ClientSharePayload } from '../../types/api';
import { useT } from '../../i18n';

/** Fallback frame rate, used when the share does not announce the media's own. */
const FALLBACK_FPS = 24;
/** Fallback start frame, same convention as the backend (`project.startFrame`). */
const FALLBACK_START_FRAME = 1001;

/**
 * Viewer of the client page (35.D): **all four media types**, and now the drawing tools on
 * all four.
 *
 * Annotation is not rewritten for the guest: `AnnotationCanvas`, `useAnnotations` and
 * `useAnnotationOverlay` from the internal review are reused, as they depend on neither an
 * account nor an authenticated request. The drawing travels with the comment, in the format
 * the review reads back, so the artist can reopen the client's feedback and land on the
 * right frame with the stroke in the right place.
 *
 * The per-viewer watermark (35.B) covers all four types, overlay included.
 */
export default function ClientMediaViewer({
  token,
  media,
  canComment,
  decisionStatuses,
  watermarkText,
  watermarkOpacity,
  onBack,
}: {
  token: string;
  media: ClientMedia;
  canComment: boolean;
  /** The two offered answers, or `null` if the link is not allowed to give a verdict. */
  decisionStatuses: ClientSharePayload['decisionStatuses'];
  watermarkText: string | null;
  watermarkOpacity: number;
  onBack: () => void;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [fpsOverride, setFpsOverride] = useState<number | null>(null);
  // One name for everything the guest posts: their note and their answer.
  const [guestName, setGuestName] = useGuestName();
  const ann = useAnnotations();
  const overlay = useAnnotationOverlay(ann);

  const sourceQ = useQuery({
    queryKey: ['client-share', token, 'media', media.id, 'url'],
    queryFn: () => clientApi.get<ClientMediaSource>(token, `/media/${media.id}/url`),
    staleTime: 5 * 60 * 1000,
  });
  const source = sourceQ.data;
  // Slate first in the client derivation (35.A): comment timestamps stay expressed in the
  // media's reference frame, so they are offset at display, seek and submission.
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
   * Selecting a comment replays the seek and the drawing together. Playback would hide the
   * annotation immediately, since it is aligned to ONE frame, so we pause, as the internal
   * review does.
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
  // Drawing is opened whenever the link allows feedback: a read-only link offers no tool,
  // since it would have nowhere to send it.
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
          {/* "Hide annotation" pill: the same as in review, Escape included. */}
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
        annotationBar={canAnnotate ? <ClientAnnotationBar ann={ann} /> : undefined}
        hasAnnotation={ann.annot.length > 0}
        guestName={guestName}
        onGuestName={setGuestName}
        decision={
          decisionStatuses ? (
            <ClientDecision token={token} media={media} statuses={decisionStatuses} guestName={guestName} />
          ) : undefined
        }
      />
    </div>
  );
}
