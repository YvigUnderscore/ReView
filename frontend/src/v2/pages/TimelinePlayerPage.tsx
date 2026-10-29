// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { parseIdParam } from '../lib/slug';
import { useAuth } from '../stores/useAuth';
import { userColor } from '../lib/userColor';
import PageShell from '../components/PageShell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import { Button } from '../components/ui/button';
import { SkeletonRows } from '../components/ui/skeleton';
import ReviewChrome from './review/chrome/ReviewChrome';
import { useChromeState } from './review/chrome/useChromeState';
import MediaOptions from './review/options/MediaOptions';
import CommentsPanel from './review/CommentsPanel';
import VideoTransport from './review/VideoTransport';
import { useAnnotations } from './review/useAnnotations';
import { useAnnotationOverlay } from './review/useAnnotationOverlay';
import { splitAnnotationParts } from './review/reviewTypes';
import MontageStage from './timeline/MontageStage';
import { useStillSource } from './timeline/useStillSource';
import MontageTimeline from './timeline/MontageTimeline';
import MontagePanels from './timeline/MontagePanels';
import MontageHeader, { ShareToShotItem } from './timeline/MontageHeader';
import { MONTAGE_MODES, montageToolsFor } from './timeline/montageChrome';
import TimelineTrack from './timeline/TimelineTrack';
import { useContinuousPlayback } from './timeline/useContinuousPlayback';
import { localTimeAt } from './timeline/timelinePlayback';
import type { MontageComment } from './timeline/montageFeedback';
import type { Shape } from '../components/AnnotationCanvas';
import type { ReviewComment, TimelineView } from '../types/api';
import { useT } from '../i18n';

/**
 * Review of an edit (Phase 46) — the video review page, applied to the whole film.
 *
 * Everything sits in its usual place: mode switch, tool rail, options bar, inspector
 * dock, transport, comment space. Only the timeline changes nature — it is
 * the edit's, a single scale from zero to the end of the film — and the image is served by
 * two players taking turns, so that the move from one shot to the next cuts nothing.
 *
 * The feedback belongs to the edit. Each item stays anchored to the shot's media and to its frame:
 * the right click "send back to the shot's review" brings it up, on that image.
 */
export default function TimelinePlayerPage() {
  const t = useT();
  const { id } = useParams();
  const timelineId = parseIdParam(id);
  return <MontageReview key={timelineId} timelineId={timelineId} label={t('timeline.defaultName')} />;
}

function MontageReview({ timelineId, label }: { timelineId: number; label: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const userId = useAuth((s) => s.user?.id) ?? 0;
  const role = useAuth((s) => s.user?.role);
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';

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
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const playback = useContinuousPlayback(items, videoA, videoB, Number(params.get('t')) || 0);
  const { clip } = playback;
  // Shot image: it takes its place in the edit, but as an `<img>` — an image handed
  // to the video element fails at demultiplexing and blocked playback of the whole edit.
  const stillUrl = useStillSource(clip);

  // The edit has a single mode and a single rail: the keyboard follows both. Without this, the key
  // `2` armed a "Compare" mode that the header does not offer, and the letters of the review's
  // tools armed tools absent from this rail.
  const { state, update } = useChromeState('VIDEO', {
    modes: MONTAGE_MODES,
    tools: montageToolsFor,
  });
  const ann = useAnnotations({ defaultColor: userColor(userId) });
  const renderOverlay = useAnnotationOverlay(ann);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [loopAll, setLoopAll] = useState(false);

  if (timelineQ.isLoading) return <SkeletonRows count={4} />;
  if (!timeline) return <p className="p-6 text-sm text-destructive">{t('timeline.notFound')}</p>;

  const name = timeline.name ?? label;
  const fps = timeline.framerate || 24;
  const localTime = clip ? localTimeAt(clip, playback.time) : 0;
  const tools = montageToolsFor(state.mode);
  const activeTool = tools.find((x) => x.id === state.tool) ?? tools[0];
  const applyVolume = (v: number, mute: boolean) => {
    for (const ref of [videoA, videoB]) {
      if (ref.current) {
        ref.current.volume = v;
        ref.current.muted = mute;
      }
    }
  };

  const clearSelection = () => {
    setSelectedId(null);
    ann.clearViewed();
  };

  /** Opening a feedback item: stops on its image in the film and its drawing reappears. */
  const selectComment = (c: ReviewComment) => {
    const m = c as MontageComment;
    setSelectedId(m.id);
    playback.pause();
    playback.seek(m.timelineTime ?? 0);
    const { shapes } = splitAnnotationParts(m.annotation);
    ann.setAnnotating(false);
    ann.setViewed(shapes.length > 0 ? (shapes as unknown as Shape[]) : null);
  };

  const submitComment = async (content: string): Promise<boolean> => {
    if (clip?.mediaId == null) {
      toast.error(t('timeline.noMediaToComment'));
      return false;
    }
    try {
      await api.post('/api/comments', {
        mediaObjectId: clip.mediaId,
        content: content.trim() || t('comment.annotationAttached'),
        // Both scales together: the frame WITHIN the shot (which will allow the send-back) and
        // the position in the film, the only scale the edit's timeline carries.
        timestamp: Math.max(0, Math.round(localTime * 1000) / 1000),
        timelineId: timeline.id,
        timelineTime: Math.max(0, Math.round(playback.time * 1000) / 1000),
        annotation: ann.annot.length > 0 ? ann.annot : undefined,
      });
      ann.resetComposer();
      await qc.invalidateQueries({ queryKey: qk.timelineComments(timeline.id) });
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
      return false;
    }
  };

  const setDepartment = async (department: string | null) => {
    await api.patch(`/api/timelines/${timeline.id}`, { department });
    await qc.invalidateQueries({ queryKey: ['timeline'] });
  };
  const snapshot = async () => {
    const { snapshot: created } = await api.post<{ snapshot: { revision: number } }>(
      `/api/timelines/${timeline.id}/snapshots`,
      {},
    );
    toast.success(t('timeline.snapshotTaken', { revision: created.revision }));
    await qc.invalidateQueries({ queryKey: ['timeline'] });
  };

  const fullscreen = (el: HTMLElement | null) => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el?.requestFullscreen().catch(() => undefined);
  };

  return (
    <PageShell
      title={name}
      breadcrumb={<EntityBreadcrumb entity="project" id={timeline.projectId} />}
      width="flush"
    >
      <div ref={rootRef} className="min-h-0 flex-1 p-4">
        <ReviewChrome
          kind="VIDEO"
          state={state}
          onState={update}
          role={role ?? 'ARTIST'}
          modes={MONTAGE_MODES}
          tools={tools}
          headerLeft={<MontageHeader name={name} clip={clip} timeline={timeline} />}
          options={<MediaOptions tool={activeTool} mode={state.mode} ann={ann} />}
          panel={
            <MontagePanels
              panel={state.panel}
              timeline={timeline}
              canManage={canManage}
              onDepartment={(d) => void setDepartment(d)}
              onSnapshot={() => void snapshot()}
            />
          }
          drawer={
            state.drawer === 'strip' ? (
              <div className="flex-shrink-0 border-t border-border bg-card px-2.5 py-2">
                <TimelineTrack
                  items={items}
                  total={timeline.totalDuration}
                  time={playback.time}
                  currentIndex={playback.index}
                  onSeek={playback.seek}
                  timelineId={timeline.id}
                />
              </div>
            ) : undefined
          }
          transport={
            <div className="rv-transport justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => update({ drawer: state.drawer === 'strip' ? null : 'strip' })}
                title={t('timeline.shotsTrack')}
              >
                {state.drawer === 'strip' ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                {t('timeline.shots')}
              </Button>
            </div>
          }
          comments={
            <CommentsPanel
              comments={commentsQ.isLoading ? null : comments}
              // Draft key specific to the edit: a negative id cannot cross any
              // media, and the text in progress survives the change of shot.
              mediaObjectId={-timeline.id}
              currentUserId={userId}
              currentUserRole={role}
              reload={() => void qc.invalidateQueries({ queryKey: qk.timelineComments(timeline.id) })}
              fps={fps}
              startFrame={1}
              selectedId={selectedId}
              onSelect={selectComment}
              composerRef={composerRef}
              hints={{ annotation: ann.annot.length > 0, camera: false }}
              onSubmit={submitComment}
              annotating={ann.annotating}
              onToggleAnnotate={() => {
                clearSelection();
                playback.pause();
                ann.setAnnotating((a) => !a);
                update({ mode: ann.annotating ? 'explore' : 'annotate' });
              }}
              extraActions={(c) => (
                <ShareToShotItem
                  comment={c as MontageComment}
                  clips={items}
                  onShared={() => qc.invalidateQueries({ queryKey: qk.timelineComments(timeline.id) })}
                />
              )}
            />
          }
        >
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5">
            <MontageStage
              zoneRef={stageRef}
              clip={clip}
              active={playback.active}
              videoA={videoA}
              videoB={videoB}
              stillUrl={stillUrl}
              overlay={renderOverlay()}
              onClick={playback.toggle}
            />
            <MontageTimeline
              items={items}
              total={timeline.totalDuration}
              time={playback.time}
              currentIndex={playback.index}
              comments={comments}
              selectedId={selectedId}
              onSeek={(target) => {
                clearSelection();
                playback.seek(target);
              }}
              onSelectComment={selectComment}
            />
            <VideoTransport
              playing={playback.playing}
              onPlayPause={playback.toggle}
              onStep={(delta) => {
                playback.pause();
                playback.seek(Math.min(Math.max(playback.time + delta / fps, 0), timeline.totalDuration));
              }}
              startFrame={1}
              currentFrame={Math.round(playback.time * fps)}
              duration={timeline.totalDuration}
              fps={fps}
              fpsDetected
              setFpsOverride={() => undefined}
              volume={volume}
              muted={muted}
              onVolume={(v) => {
                setVolume(v);
                setMuted(v === 0);
                applyVolume(v, v === 0);
              }}
              onToggleMute={() => {
                setMuted((m) => {
                  applyVolume(volume, !m);
                  return !m;
                });
              }}
              onFullscreen={() => fullscreen(rootRef.current)}
              onFullscreenVideo={() => fullscreen(stageRef.current)}
              videoOnlyFs={false}
              loopActive={false}
              loopEnabled={false}
              onToggleLoopEnabled={() => undefined}
              onClearLoop={() => undefined}
              loopAll={loopAll}
              onToggleLoopAll={() => setLoopAll((l) => !l)}
            />
          </div>
        </ReviewChrome>
      </div>
    </PageShell>
  );
}
