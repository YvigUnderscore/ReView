// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from 'react';
import { AnnotationCanvas, type Shape } from '../../components/AnnotationCanvas';
import { userColor } from '../../lib/userColor';
import type { ReviewComment } from '../../types/api';
import { splitAnnotationParts } from './reviewTypes';
import { useT } from '../../i18n';

/**
 * Annotations sur plage in→out (34.A) : un commentaire posé avec une boucle I/O active
 * porte une part `range {inFrame,outFrame}` — ses dessins restent visibles pendant toute
 * la plage à la lecture (au lieu de n'apparaître qu'à la sélection du commentaire).
 */

/** Plages des commentaires (memoïsable) : id → {range, shapes}. */
function rangedOf(comments: ReviewComment[]) {
  return comments
    .map((c) => {
      const { range, shapes } = splitAnnotationParts(c.annotation);
      return range ? { comment: c, range, shapes } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Overlay : dessins des commentaires dont la plage couvre la frame courante. */
export function RangeAnnotationsOverlay({
  comments,
  currentFrame,
  selectedId,
}: {
  comments: ReviewComment[];
  currentFrame: number;
  /** Commentaire sélectionné — déjà rendu par l'overlay de sélection (pas de doublon). */
  selectedId: number | null;
}) {
  const ranged = useMemo(() => rangedOf(comments), [comments]);
  const shapes = ranged
    .filter(
      (r) =>
        r.comment.id !== selectedId &&
        r.shapes.length > 0 &&
        currentFrame >= r.range.inFrame &&
        currentFrame <= r.range.outFrame,
    )
    .flatMap((r) => r.shapes) as Shape[];
  if (shapes.length === 0) return null;
  return (
    <AnnotationCanvas shapes={shapes} editable={false} tool="draw" color="#ffffff" width={2} margin={0.5} />
  );
}

/**
 * Segments de plage sur la timeline : barre fine à la couleur de l'auteur, poignées aux
 * extrémités ; clic = sélectionne le commentaire (et se cale sur son point d'entrée).
 */
export function RangeSegments({
  comments,
  duration,
  fps,
  selectedId,
  onSelectComment,
}: {
  comments: ReviewComment[];
  duration: number;
  fps: number;
  selectedId: number | null;
  onSelectComment: (c: ReviewComment) => void;
}) {
  const t = useT();
  const ranged = useMemo(() => rangedOf(comments), [comments]);
  if (duration <= 0 || ranged.length === 0) return null;
  return (
    <>
      {ranged.map(({ comment: c, range }) => {
        const tIn = range.inFrame / (fps || 24);
        const tOut = range.outFrame / (fps || 24);
        if (tIn > duration) return null;
        const left = (tIn / duration) * 100;
        const width = (Math.min(tOut, duration) - tIn) / duration;
        const color = userColor(c.author?.id ?? 0);
        return (
          <button
            key={c.id}
            className={`absolute top-0.5 z-[12] h-1.5 rounded-full transition-opacity ${
              c.id === selectedId ? 'opacity-100' : 'opacity-70 hover:opacity-100'
            }`}
            style={{
              left: `calc(${left}% * (100% - 8px) / 100% + 4px)`,
              width: `max(${width * 100}%, 6px)`,
              background: color,
              boxShadow: `-2px 0 0 ${color}, 2px 0 0 ${color}`, // poignées aux extrémités
            }}
            title={t('comment.rangeAnnotation', {
              name: c.author?.displayName ?? c.author?.name ?? t('common.unknown'),
              content: c.content.slice(0, 60),
            })}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSelectComment(c);
            }}
          />
        );
      })}
    </>
  );
}
