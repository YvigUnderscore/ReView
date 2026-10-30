// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode, RefObject } from 'react';
import ReviewHeaderActions from './ReviewHeaderActions';
import ReviewHeaderIdentity from './ReviewHeaderIdentity';
import ReviewCommentsColumn from './ReviewCommentsColumn';
import { chromeHostsHeader } from './headerComposition';
import type { ReviewComment } from '@/v2/types/api';
import type { MediaResp } from '../reviewTypes';
import type { useAnnotations } from '../useAnnotations';
import type { useCompareState } from '../useCompareState';
import type { useLiveSession } from '../useLiveSession';
import type { useTimelineMarkers } from '../useTimelineMarkers';
import type { PoiPoint } from '../poi/poiPoints';

interface Params {
  id: number;
  data: MediaResp | null;
  kind: MediaResp['media']['kind'] | undefined;
  theater: boolean;
  compare: ReturnType<typeof useCompareState>;
  live: ReturnType<typeof useLiveSession>;
  commentsOpen: boolean;
  setCommentsOpen: (update: (open: boolean) => boolean) => void;
  setTheater: (on: boolean) => void;
  onPublish: () => void | Promise<void>;
  onPictureInPicture: () => void | Promise<void>;
  comments: ReviewComment[] | null;
  userId: number;
  role: string | undefined;
  loadComments: () => void | Promise<void>;
  fps: number;
  startFrame: number;
  selectedCommentId: number | null;
  selectComment: (c: ReviewComment) => void;
  markersApi: ReturnType<typeof useTimelineMarkers>;
  seek: (t: number) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  ann: ReturnType<typeof useAnnotations>;
  loop: { in: number | null; out: number | null };
  submitComment: Parameters<typeof ReviewCommentsColumn>[0]['onSubmit'];
  toggleAnnotating: () => void;
  /** Camera return to a point of interest being reviewed (number clicked in the thread). */
  onPoiFocus: (point: PoiPoint, index: number) => void;
}

export interface ReviewHeaderSlots {
  /** Does the viewer chrome host the header, or must the page render it itself? */
  hosted: boolean;
  identity: ReactNode;
  actions: ReactNode;
  comments: ReactNode;
}

/**
 * Composition of the review's single header.
 *
 * The page used to render its own bar above the viewer chrome, which already carries the mode
 * toggle and the A/B: two headers stacked for a single screen. Identity, actions and comments now
 * go down into the chrome through a context, for the four media types, without passing through
 * `ReviewViewer` or its four branches.
 *
 * Only one state mounts no chrome: loading. `hosted` is then false and the page renders the header
 * itself. Hence three slots rendered here, and a flag saying where to place them, rather than two
 * parallel constructions to keep in agreement.
 */
export function useReviewHeaderSlots(p: Params): ReviewHeaderSlots {
  const hosted = !p.theater && chromeHostsHeader({ hasData: !!p.data, kind: p.kind });

  const visible = p.data && !p.theater;

  return {
    hosted,
    identity: visible ? <ReviewHeaderIdentity data={p.data as MediaResp} /> : null,
    actions: visible ? (
      <ReviewHeaderActions
        data={p.data as MediaResp}
        onPublish={p.onPublish}
        commentsOpen={p.commentsOpen}
        onToggleComments={() => p.setCommentsOpen((o) => !o)}
        compareIds={p.compare.compareIds}
        onAddCompare={p.compare.addCompareId}
        onRemoveCompare={p.compare.removeCompareId}
        onCompareChange={p.compare.setCompareId}
        onToggleTheater={() => p.setTheater(true)}
        onPictureInPicture={p.onPictureInPicture}
        live={p.live}
      />
    ) : null,
    comments:
      p.commentsOpen && !p.theater ? (
        <ReviewCommentsColumn
          mediaObjectId={p.id}
          kind={p.kind}
          comments={p.comments}
          currentUserId={p.userId}
          currentUserRole={p.role}
          reload={p.loadComments}
          fps={p.fps}
          startFrame={p.startFrame}
          selectedId={p.selectedCommentId}
          onSelect={p.selectComment}
          markersApi={p.markersApi}
          onSeek={p.seek}
          composerRef={p.composerRef}
          ann={p.ann}
          loop={p.loop}
          onSubmit={p.submitComment}
          onToggleAnnotate={p.toggleAnnotating}
          onPoiFocus={p.onPoiFocus}
        />
      ) : null,
  };
}
