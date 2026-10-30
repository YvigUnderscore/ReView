// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import CollapsibleText from '@/v2/components/comments/CollapsibleText';
import type { PoiCardImage } from './poiCards';
import { useT } from '@/v2/i18n';

/**
 * A point's remark, as it is READ: in the comment thread as well as on the card anchored in the scene.
 * A single writing serves both surfaces: the remark used to read differently depending on the place, and
 * overflowed in both possible ways.
 *
 * Three rules, requested by use:
 *
 *  - **nothing scrolls sideways**: the text wraps, and `break-words` even cuts what has no space (a scene
 *    path, a render URL) instead of pushing the row out of the column;
 *  - **three lines, no more** until one has scrolled: the folding of batch 5 (`CollapsibleText`) is reused
 *    as it is, tightened to three lines;
 *  - **the thumbnail beside the text**, never below: that is what allows scanning a thread of points while
 *    seeing at a glance what each one is about.
 *
 * Beyond one image, the rest goes through a "+n" tile, the same convention as a comment's attachments
 * (`CommentAttachmentList`), and everything opens in the shared Lightbox, the one of the thread and of the
 * image review.
 */

/** Three lines: what a remark shows without having to unfold it. */
const NOTE_LINES = 3;

export default function PoiNoteBody({
  text,
  images,
  onImage,
  stop,
  className,
}: {
  text: string;
  images: readonly PoiCardImage[];
  /** Opens the shared Lightbox on the image of this rank. */
  onImage: (at: number) => void;
  /** Prevents an internal click from replaying the selection of the comment card. */
  stop?: (e: React.MouseEvent) => void;
  /** Typography of the host surface: `text-sm` in the thread, `text-xs` in the scene. */
  className?: string;
}) {
  const t = useT();
  const openAt = (e: React.MouseEvent, at: number) => {
    stop?.(e);
    onImage(at);
  };
  const [first, ...rest] = images;

  return (
    <div className="flex items-start gap-1.5">
      {/* `min-w-0`: without it, a flex child refuses to shrink below the width of its
          content: that is exactly what made the row scroll sideways. */}
      <div className={`min-w-0 flex-1 ${className ?? ''}`}>
        <CollapsibleText text={text} lines={NOTE_LINES} className="whitespace-pre-wrap break-words">
          {text}
        </CollapsibleText>
      </div>
      {first && (
        <div className="flex shrink-0 items-start gap-1">
          <button
            type="button"
            onClick={(e) => openAt(e, 0)}
            title={first.alt || t('comments.openAttachment')}
            aria-label={t('comments.openAttachment')}
          >
            <img
              src={first.src}
              alt={first.alt}
              className="h-12 w-12 rounded border border-border object-cover"
            />
          </button>
          {rest.length > 0 && (
            <button
              type="button"
              onClick={(e) => openAt(e, 1)}
              title={t('comment.seeAllImages')}
              aria-label={t('comment.seeAllImages')}
              className="flex h-12 w-12 flex-col items-center justify-center rounded border border-border bg-secondary/60 text-2xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <span className="text-xs font-semibold">+{rest.length}</span>
              {t('comment.images')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
