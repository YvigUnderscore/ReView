// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RefObject } from 'react';
import CommentsPanel from '../CommentsPanel';
import type { ReviewComment } from '@/v2/types/api';
import type { MediaResp } from '../reviewTypes';
import type { useAnnotations } from '../useAnnotations';
import type { useTimelineMarkers } from '../useTimelineMarkers';
import type { PoiPoint } from '../poi/poiPoints';

type Ann = ReturnType<typeof useAnnotations>;
type MarkersApi = ReturnType<typeof useTimelineMarkers>;
type Loop = { in: number | null; out: number | null };

interface Props {
  mediaObjectId: number;
  kind: MediaResp['media']['kind'] | undefined;
  comments: ReviewComment[] | null;
  currentUserId: number;
  currentUserRole: string | undefined;
  reload: () => void | Promise<void>;
  fps: number;
  startFrame: number;
  selectedId: number | null;
  onSelect: (c: ReviewComment) => void;
  markersApi: MarkersApi;
  onSeek: (t: number) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  ann: Ann;
  loop: Loop;
  onSubmit: Parameters<typeof CommentsPanel>[0]['onSubmit'];
  onToggleAnnotate: () => void;
  /** Camera return to a point of interest being reviewed (number clicked in a thread card). */
  onPoiFocus: (point: PoiPoint, index: number) => void;
}

/**
 * Review comments column.
 *
 * Extracted from `ReviewPage` for two reasons. The page was barely within its 300-line budget,
 * and, more importantly, the composer's "hints" (what will be attached to the comment: annotation,
 * 3D point, camera, references, range) are all derived from the review state. Computing them here
 * rather than passing them one by one keeps the rule next to what it describes, instead of
 * spreading it across the caller's prop list.
 *
 * Points of interest are no longer a boolean hint: they have their rows in the composer (`poi`),
 * which say how many there are and what each one carries.
 */
export default function ReviewCommentsColumn({
  mediaObjectId,
  kind,
  comments,
  currentUserId,
  currentUserRole,
  reload,
  fps,
  startFrame,
  selectedId,
  onSelect,
  markersApi,
  onSeek,
  composerRef,
  ann,
  loop,
  onSubmit,
  onToggleAnnotate,
  onPoiFocus,
}: Props) {
  return (
    <CommentsPanel
      comments={comments}
      mediaObjectId={mediaObjectId}
      currentUserId={currentUserId}
      currentUserRole={currentUserRole}
      reload={reload}
      fps={fps}
      startFrame={startFrame}
      selectedId={selectedId}
      onSelect={onSelect}
      markers={kind === 'VIDEO' ? markersApi.markers : undefined}
      onMarkerSeek={(m) => onSeek(m.frame / fps)}
      composerRef={composerRef}
      hints={{
        annotation: ann.annot.length > 0,
        // The camera view is captured for EVERY spatial comment (`useSubmitComment`), splat
        // included, without waiting for annotation mode: the hint was therefore wrong twice over.
        camera: kind === 'MODEL_3D' || kind === 'SPLAT',
        // Camera animation attached (transport button): stated here, where what is sent is reviewed.
        cameraAnim: ann.cameraAnim != null,
        references: ann.stagedRefs.length,
        // A range is a hint only if it is complete and oriented: `out > in`.
        range: kind === 'VIDEO' && loop.in != null && loop.out != null && loop.out > loop.in,
      }}
      onSubmit={onSubmit}
      annotating={ann.annotating}
      onToggleAnnotate={onToggleAnnotate}
      poi={ann.poi}
      onPoiFocus={onPoiFocus}
    />
  );
}
