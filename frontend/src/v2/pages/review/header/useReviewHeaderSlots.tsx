// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode, RefObject } from 'react';
import ReviewHeaderActions from './ReviewHeaderActions';
import ReviewHeaderIdentity from './ReviewHeaderIdentity';
import ReviewCommentsColumn from './ReviewCommentsColumn';
import { chromeHostsHeader } from './headerComposition';
import type { ReviewComment } from '../../../types/api';
import type { MediaResp } from '../reviewTypes';
import type { useAnnotations } from '../useAnnotations';
import type { useCompareState } from '../useCompareState';
import type { useLiveSession } from '../useLiveSession';
import type { useTimelineMarkers } from '../useTimelineMarkers';

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
}

export interface ReviewHeaderSlots {
  /** Le chrome du viewer héberge-t-il l'en-tête, ou la page doit-elle le rendre elle-même ? */
  hosted: boolean;
  identity: ReactNode;
  actions: ReactNode;
  comments: ReactNode;
}

/**
 * Composition de l'en-tête unique de la review.
 *
 * La page rendait sa propre barre au-dessus du chrome du viewer, qui porte déjà la bascule
 * de mode et l'A/B : deux en-têtes empilés pour un seul écran. Identité, actions et
 * commentaires descendent maintenant dans le chrome par contexte — pour les quatre types de
 * média, sans traverser `ReviewViewer` ni ses quatre branches.
 *
 * Un seul état ne monte aucun chrome : le chargement. `hosted` est alors faux et la page rend
 * l'en-tête elle-même — d'où trois emplacements rendus ici, et un drapeau qui dit où les
 * poser, plutôt que deux constructions parallèles à garder d'accord.
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
        />
      ) : null,
  };
}
