// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { ChevronLeft, ChevronRight, Grid2x2 } from 'lucide-react';
import { Lightbox } from '../ui/lightbox';
import { REFS_COLS, REFS_HEIGHT, isNoteImageKey, type NoteImage, type RefsBlock } from './noteMarkdown';
import { useNoteImageResolver } from './noteImages';
import { useT } from '../../i18n';

/**
 * A note's references: a board, or a carousel.
 *
 * A board is looked at in two ways, and both are needed: all together, when one seeks the coherence of a set; and one
 * by one, enlarged, when one seeks a detail. The layout written in the note decides the first; the second is always one
 * click away, in the lightbox shared across the whole application.
 *
 * The carousel remains the layout of notes written before boards: their rendering does not change by a line.
 */

/** Columns are written as full classes: Tailwind does not read computed names. */
const COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
};

/** A thumbnail, or its frame while the read URL has not come back. */
function Thumb({ image, height, onClick }: { image: NoteImage; height: number; onClick: () => void }) {
  const resolve = useNoteImageResolver();
  const src = resolve(image.src) ?? (isNoteImageKey(image.src) ? null : image.src);

  if (!src) {
    return (
      <span
        className="block w-full rounded-md border border-dashed border-border bg-secondary/30"
        style={{ height }}
        aria-hidden
      />
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={image.alt || undefined}
      className="overflow-hidden rounded-md border border-border transition-colors hover:border-primary"
    >
      <img
        src={src}
        alt={image.alt}
        loading="lazy"
        decoding="async"
        style={{ height }}
        className="w-full object-cover"
      />
    </button>
  );
}

export default function NoteRefs({
  images,
  layout,
  cols = REFS_COLS.default,
  height = REFS_HEIGHT.default,
}: Pick<RefsBlock, 'images' | 'layout' | 'cols' | 'height'>) {
  const t = useT();
  const resolve = useNoteImageResolver();
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);

  if (images.length === 0) return null;
  const current = images[Math.min(index, images.length - 1)];
  const go = (delta: number) => setIndex((i) => (i + delta + images.length) % images.length);

  /** The lightbox only shows what is displayable: an unresolved key has no place there. */
  const zoomable = images
    .map((image) => ({ src: resolve(image.src) ?? image.src, alt: image.alt }))
    .filter((image) => !isNoteImageKey(image.src));

  const open = (i: number) => {
    setIndex(i);
    setZoomed(true);
  };

  const lightbox = (
    <Lightbox
      images={zoomable}
      index={Math.min(index, Math.max(zoomable.length - 1, 0))}
      open={zoomed && zoomable.length > 0}
      onOpenChange={setZoomed}
      onIndexChange={setIndex}
    />
  );

  if (layout === 'grid') {
    return (
      <div className="space-y-1.5">
        <div className={`grid gap-2 ${COLS[cols] ?? COLS[REFS_COLS.default]}`}>
          {images.map((image, i) => (
            <Thumb key={`${image.src}-${i}`} image={image} height={height} onClick={() => open(i)} />
          ))}
        </div>
        {lightbox}
      </div>
    );
  }

  const currentSrc = resolve(current.src) ?? (isNoteImageKey(current.src) ? null : current.src);

  return (
    <div className="space-y-1.5">
      <div className="relative overflow-hidden rounded-md border border-border bg-secondary/30">
        {currentSrc ? (
          <img
            src={currentSrc}
            alt={current.alt}
            loading="lazy"
            decoding="async"
            className="mx-auto max-h-64 w-full object-contain"
          />
        ) : (
          <span className="block h-64 w-full" aria-hidden />
        )}
        {images.length > 1 && (
          <>
            <button
              onClick={() => go(-1)}
              aria-label={t('refs.previous')}
              className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1 text-foreground hover:bg-background"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => go(1)}
              aria-label={t('refs.next')}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-1 text-foreground hover:bg-background"
            >
              <ChevronRight size={16} />
            </button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
        {current.alt && <span className="truncate">{current.alt}</span>}
        <span className="ml-auto shrink-0 tabular-nums">
          {index + 1} / {images.length}
        </span>
        <button
          onClick={() => open(index)}
          className="flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:bg-secondary/60"
        >
          <Grid2x2 size={12} /> {t('refs.seeAll')}
        </button>
      </div>
      {lightbox}
    </div>
  );
}
