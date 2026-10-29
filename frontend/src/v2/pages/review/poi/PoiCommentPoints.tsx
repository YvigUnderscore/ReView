// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Lightbox } from '../../../components/ui/lightbox';
import { isImageAttachment, type CommentAttachment } from '../../../../lib/commentAttachments';
import PoiNoteBody from './PoiNoteBody';
import type { PoiCardImage } from './poiCards';
import type { PoiPoint } from './poiPoints';
import { useT } from '../../../i18n';

/**
 * Points of interest of a comment, on review: a numbered row per point, its remark, and its images.
 *
 * **Clicking the number brings the camera back to the point** (`onFocus`). Replay is valid for every
 * viewer: the point is stored in OBJECT space, like the camera presentation, so the framing lands in the
 * same place whatever the transformation of the media.
 *
 * Without `onFocus` (no spatial viewer at hand), the numbers remain plain text: one reads the remark, one
 * does not fly off towards it.
 *
 * The remark itself is rendered by `PoiNoteBody`, shared with the scene cards: line breaks, three lines
 * at most, thumbnail beside it.
 */
export default function PoiCommentPoints({
  points,
  attachments,
  onFocus,
  stop,
}: {
  points: readonly PoiPoint[];
  attachments?: readonly CommentAttachment[];
  onFocus?: (point: PoiPoint, index: number) => void;
  /** Prevents an internal click from replaying the selection of the comment card. */
  stop: (e: React.MouseEvent) => void;
}) {
  const t = useT();
  // Shared carousel: the index refers to the images of THIS point (the open batch), not to the thread.
  const [lightbox, setLightbox] = useState<{ images: PoiCardImage[]; at: number } | null>(null);
  if (points.length === 0) return null;

  const imagesOf = (point: PoiPoint): PoiCardImage[] =>
    (point.images ?? [])
      .map((key) => attachments?.find((a) => a.key === key))
      .filter((a): a is CommentAttachment => !!a?.url && isImageAttachment(a.contentType))
      .map((a) => ({ src: a.url ?? '', alt: a.name ?? '' }));

  return (
    <ol aria-label={t('poi.listLabel')} className="mt-1 space-y-1">
      {points.map((point, index) => {
        const images = imagesOf(point);
        return (
          <li key={index} className="flex items-start gap-1.5 text-sm">
            {onFocus ? (
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  onFocus(point, index);
                }}
                title={t('poi.focus', { n: index + 1 })}
                aria-label={t('poi.focus', { n: index + 1 })}
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                {index + 1}
              </button>
            ) : (
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
                {index + 1}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <PoiNoteBody
                text={point.text ?? ''}
                images={images}
                onImage={(at) => setLightbox({ images, at })}
                stop={stop}
              />
            </div>
          </li>
        );
      })}
      {lightbox && (
        <Lightbox
          images={lightbox.images}
          index={lightbox.at}
          open
          onOpenChange={(open) => !open && setLightbox(null)}
          onIndexChange={(at) => setLightbox((l) => (l ? { ...l, at } : l))}
        />
      )}
    </ol>
  );
}
