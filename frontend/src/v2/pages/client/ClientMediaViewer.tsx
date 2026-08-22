// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { clientApi } from './clientApi';
import ClientComments from './ClientComments';
import ClientModel3DView from './ClientModel3DView';
import ClientSplatView from './ClientSplatView';
import ClientUnavailable from './ClientUnavailable';
import ClientVideoPlayer from './ClientVideoPlayer';
import { mediaTimeOf, playerTimeOf, toPlayerComments } from './clientViewerModel';
import type { ClientMediaSource } from './clientTypes';
import WatermarkOverlay from '../../components/WatermarkOverlay';
import { VIEWER_ZONE } from '../review/reviewTypes';
import type { ClientComment, ClientMedia } from '../../types/api';
import { useT } from '../../i18n';

/** Cadence de repli quand le partage n'annonce pas celle du média. */
const FALLBACK_FPS = 24;
/** Première frame de repli — même convention que le backend (`project.startFrame`). */
const FALLBACK_START_FRAME = 1001;

/**
 * Viewer de la page client (35.D) — **les quatre types de médias**, pas seulement la 2D.
 * Vidéo et image gardent leur lecteur, la 3D et le splat montent les viewers de la review en
 * lecture seule : ce que ReView sait faire de spécifique est désormais ce que le client voit.
 * Le filigrane par spectateur (35.B) couvre les quatre.
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
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [fpsOverride, setFpsOverride] = useState<number | null>(null);

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

  const submitComment = useCallback(
    async (guestName: string, content: string) => {
      try {
        localStorage.setItem('client-guest-name', guestName);
        const timestamp =
          isVideo && videoRef.current ? mediaTimeOf(videoRef.current.currentTime, slateSec) : undefined;
        await clientApi.post(token, `/media/${media.id}/comments`, {
          guestName,
          content,
          ...(timestamp !== undefined ? { timestamp } : {}),
        });
        toast.success(t('comments.sent'));
        void qc.invalidateQueries({ queryKey: ['client-share', token, 'media', media.id, 'comments'] });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('common.error.generic'));
      }
    },
    [isVideo, media.id, qc, slateSec, t, token],
  );

  const watermark = watermarkText ? (
    <WatermarkOverlay text={watermarkText} opacity={watermarkOpacity} />
  ) : null;
  const loading = sourceQ.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        <button
          onClick={onBack}
          className="mb-3 flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={15} /> {t('versions.allMedia')}
        </button>

        {media.kind === 'MODEL_3D' ? (
          <ClientModel3DView source={source} loading={loading} watermark={watermark} />
        ) : media.kind === 'SPLAT' ? (
          <ClientSplatView
            source={source}
            originalName={media.originalName}
            loading={loading}
            watermark={watermark}
          />
        ) : isVideo && source ? (
          <ClientVideoPlayer
            src={source.url}
            videoRef={videoRef}
            comments={playerComments}
            selectedId={selectedId}
            onSelectComment={(c) => {
              setSelectedId(c.id);
              if (c.timestamp != null) seekMedia(mediaTimeOf(c.timestamp, slateSec));
            }}
            onMarker={() => composerRef.current?.focus()}
            fps={fps}
            fpsDetected={source.fps != null}
            setFpsOverride={setFpsOverride}
            startFrame={source.startFrame ?? FALLBACK_START_FRAME}
            watermark={watermark}
          />
        ) : (
          <div className={VIEWER_ZONE}>
            {media.kind === 'IMAGE' && source ? (
              <img
                src={source.url}
                alt={media.originalName}
                className="max-h-[70vh] max-w-full object-contain"
              />
            ) : sourceQ.error ? (
              <ClientUnavailable />
            ) : (
              <p className="p-10 text-sm text-muted-foreground">{t('common.loading')}</p>
            )}
            {watermark}
          </div>
        )}

        <p className="mt-2 truncate text-sm text-muted-foreground">{media.originalName}</p>
      </div>

      <ClientComments
        comments={comments}
        canComment={canComment}
        timed={isVideo}
        onSeek={seekMedia}
        onSubmit={submitComment}
        composerRef={composerRef}
      />
    </div>
  );
}
