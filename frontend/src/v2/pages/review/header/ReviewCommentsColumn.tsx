// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RefObject } from 'react';
import CommentsPanel from '../CommentsPanel';
import type { ReviewComment } from '../../../types/api';
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
  /** Retour caméra sur un point d'intérêt relu (numéro cliqué dans une carte du fil). */
  onPoiFocus: (point: PoiPoint, index: number) => void;
}

/**
 * Colonne de commentaires de la review.
 *
 * Extraite de `ReviewPage` pour deux raisons. La page tenait le budget de 300 lignes de
 * justesse, et surtout : les « indices » du composeur (ce qui sera joint au commentaire —
 * annotation, point 3D, caméra, références, plage) se déduisent tous de l'état de la
 * review. Les calculer ici plutôt que de les passer un par un garde la règle avec ce
 * qu'elle décrit, au lieu de l'étaler dans la liste de props de l'appelant.
 *
 * Les points d'intérêt ne sont plus un indice booléen : ils ont leurs rangées dans le composeur
 * (`poi`), qui disent combien il y en a et ce que chacun porte.
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
        camera: kind === 'MODEL_3D' && ann.annotating,
        references: ann.stagedRefs.length,
        // Une plage n'est un indice que si elle est complète et orientée : `out > in`.
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
