// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { parseIdParam, projectPath } from '../lib/slug';
import { useAuth } from '../stores/useAuth';
import { userColor } from '../lib/userColor';
import { SkeletonRows } from '../components/ui/skeleton';
import { useAnnotations } from './review/useAnnotations';
import { useAnnotationOverlay } from './review/useAnnotationOverlay';
import { splitAnnotationParts } from './review/reviewTypes';
import ReviewAnnotationBar from './review/ReviewAnnotationBar';
import MontageAnnotateBar from './timeline/MontageAnnotateBar';
import MontageStage from './timeline/MontageStage';
import MontageTransport from './timeline/MontageTransport';
import MontageComments from './timeline/MontageComments';
import TimelineTrack from './timeline/TimelineTrack';
import { useContinuousPlayback } from './timeline/useContinuousPlayback';
import { localTimeAt } from './timeline/timelinePlayback';
import { commentMarkers, type MontageComment } from './timeline/montageFeedback';
import type { Shape } from '../components/AnnotationCanvas';
import type { TimelineView } from '../types/api';
import { useT } from '../i18n';

/**
 * La page du montage (Phase 46) : le film entier, sur une seule timeline, et la review
 * qui va avec.
 *
 * Cette page ne fait rien d'autre. On y entre, on regarde le film d'un bout à l'autre —
 * les plans s'enchaînent sans coupure, séquences comprises — et l'on commente CE QU'ON
 * VOIT : le retour appartient au montage, à sa position dans le film. Aucune navigation
 * ne vient interrompre la projection, et c'est bien là tout le propos d'un montage.
 *
 * Un retour reste malgré tout ancré au média du plan et à sa frame : un clic droit dessus
 * le renvoie sur la review d'origine, exactement sur cette image.
 */
export default function TimelinePlayerPage() {
  const t = useT();
  const { id } = useParams();
  const timelineId = parseIdParam(id);
  const [params] = useSearchParams();
  const userId = useAuth((s) => s.user?.id) ?? 0;

  const timelineQ = useQuery({
    queryKey: qk.timeline(timelineId),
    queryFn: () =>
      api.get<{ timeline: TimelineView }>(`/api/timelines/${timelineId}`).then((d) => d.timeline),
    enabled: Number.isFinite(timelineId),
  });
  const timeline = timelineQ.data ?? null;
  const items = useMemo(() => timeline?.items ?? [], [timeline]);

  const commentsQ = useQuery({
    queryKey: qk.timelineComments(timelineId),
    queryFn: () =>
      api
        .get<{ items: MontageComment[] }>(`/api/timelines/${timelineId}/comments`)
        .then((d) => d.items ?? []),
    enabled: Number.isFinite(timelineId) && timelineId > 0,
  });
  const comments = useMemo(() => commentsQ.data ?? [], [commentsQ.data]);

  const videoA = useRef<HTMLVideoElement | null>(null);
  const videoB = useRef<HTMLVideoElement | null>(null);
  const startAt = Number(params.get('t')) || 0;
  const playback = useContinuousPlayback(items, videoA, videoB, startAt);
  const { clip } = playback;

  const ann = useAnnotations({ defaultColor: userColor(userId) });
  const renderOverlay = useAnnotationOverlay(ann);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Le son se règle une fois pour le film, pas pour un plan : les deux tampons suivent.
  useEffect(() => {
    for (const ref of [videoA, videoB]) {
      const v = ref.current;
      if (v) {
        v.volume = volume;
        v.muted = muted;
      }
    }
  }, [volume, muted, playback.index]);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  if (timelineQ.isLoading) return <SkeletonRows count={4} />;
  if (!timeline) return <p className="p-6 text-sm text-destructive">{t('timeline.notFound')}</p>;

  const fps = timeline.framerate || 24;
  const localTime = clip ? localTimeAt(clip, playback.time) : 0;

  /** Image par image sur le FILM : franchir une coupe est un pas comme un autre. */
  const step = (delta: number) => {
    playback.pause();
    playback.seek(Math.min(Math.max(playback.time + delta / fps, 0), timeline.totalDuration));
  };

  /** Ouvrir un retour : on s'arrête sur son image et son dessin réapparaît. */
  const selectComment = (c: MontageComment) => {
    setSelectedId(c.id);
    playback.pause();
    const target =
      c.timelineTime ??
      (items.find((x) => x.mediaId === c.mediaObjectId)?.startTime ?? 0) + (c.timestamp ?? 0);
    playback.seek(target);
    const { shapes } = splitAnnotationParts(c.annotation);
    ann.setAnnotating(false);
    ann.setViewed(shapes.length > 0 ? (shapes as unknown as Shape[]) : null);
  };

  const clearSelection = () => {
    setSelectedId(null);
    ann.clearViewed();
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen().catch(() => undefined);
  };

  return (
    <div ref={root} className="flex h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <Link
          to={projectPath({ id: timeline.projectId })}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={15} /> {t('common.back')}
        </Link>
        <h1 className="text-sm font-medium">{timeline.name ?? t('timeline.defaultName')}</h1>
        {/* Libellé permanent : on sait en continu quel plan on regarde, sans quitter le film. */}
        {clip && (
          <span className="rounded border border-border px-2 py-0.5 text-xs">
            <span className="text-muted-foreground">{clip.sequenceCode ?? '—'}</span> · {clip.shotCode}
            {clip.versionName && <span className="text-muted-foreground"> · {clip.versionName}</span>}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {t('timeline.shotCount', { count: items.length })}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <MontageAnnotateBar ann={ann} />
          {/* `relative` : la pilule « masquer l'annotation » se pose sur l'image. */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <MontageStage
              clip={clip}
              active={playback.active}
              videoA={videoA}
              videoB={videoB}
              overlay={renderOverlay()}
              onClick={playback.toggle}
            />
            <ReviewAnnotationBar ann={ann} onClearSelection={clearSelection} />
          </div>
          <div className="shrink-0 space-y-1 border-t border-border p-3">
            <TimelineTrack
              items={items}
              total={timeline.totalDuration}
              time={playback.time}
              currentIndex={playback.index}
              onSeek={(target) => {
                clearSelection();
                playback.seek(target);
              }}
              timelineId={timeline.id}
              linkToReview={false}
              markers={commentMarkers(comments, items)}
              selectedMarkerId={selectedId}
              onMarkerClick={(markerId) => {
                const found = comments.find((c) => c.id === markerId);
                if (found) selectComment(found);
              }}
            />
          </div>
          <MontageTransport
            playing={playback.playing}
            time={playback.time}
            total={timeline.totalDuration}
            fps={fps}
            muted={muted}
            volume={volume}
            fullscreen={fullscreen}
            onToggle={playback.toggle}
            onStep={step}
            onVolume={(v) => {
              setVolume(v);
              setMuted(v === 0);
            }}
            onToggleMute={() => setMuted((m) => !m)}
            onFullscreen={toggleFullscreen}
          />
        </main>

        <MontageComments
          timelineId={timeline.id}
          clips={items}
          clip={clip}
          localTime={localTime}
          montageTime={playback.time}
          items={comments}
          selectedId={selectedId}
          onSelect={selectComment}
          annotation={ann.annot.length > 0 ? ann.annot : null}
          annotating={ann.annotating}
          onToggleAnnotate={() => {
            clearSelection();
            ann.setAnnotating((a) => !a);
            playback.pause();
          }}
          onPosted={() => ann.resetComposer()}
        />
      </div>
    </div>
  );
}
