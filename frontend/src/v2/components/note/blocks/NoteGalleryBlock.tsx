// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GalleryHorizontal, LayoutGrid, X } from 'lucide-react';
import { SegmentedControl } from '../../ui/segmented-control';
import { NumberField } from '../../ui/number-field';
import { REFS_COLS, REFS_HEIGHT, isNoteImageKey, type NoteImage } from '../noteMarkdown';
import { useNoteImageResolver } from '../noteImages';
import type { GalleryBlock } from '../noteEditorModel';
import NoteImageDrop from './NoteImageDrop';
import { useT } from '@/v2/i18n';

/**
 * The reference board: several images, laid out the way one wants to see them.
 *
 * Thumbnails are arranged by dragging: the order of a board *is* its point, one puts side by side what is to be
 * compared. The columns and height are set here and written into the note: what the supervisor composes is what
 * everyone will see, without the layout depending on each person's screen width.
 *
 * The carousel is still offered, for a series one flicks through rather than takes in at once.
 */

const COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

function SortableThumb({
  image,
  index,
  height,
  onRemove,
}: {
  image: NoteImage;
  index: number;
  height: number;
  onRemove: () => void;
}) {
  const t = useT();
  const resolve = useNoteImageResolver();
  const id = `${image.src}#${index}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const src = resolve(image.src) ?? (isNoteImageKey(image.src) ? null : image.src);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative overflow-hidden rounded-md border border-border ${isDragging ? 'opacity-50' : ''}`}
    >
      {src ? (
        <img
          src={src}
          alt={image.alt}
          loading="lazy"
          decoding="async"
          style={{ height }}
          className="w-full cursor-grab object-cover"
          {...attributes}
          {...listeners}
        />
      ) : (
        <span className="block w-full bg-secondary/30" style={{ height }} aria-hidden />
      )}
      <button
        type="button"
        onClick={onRemove}
        title={t('note.images.remove')}
        aria-label={t('note.images.remove')}
        className="absolute right-1 top-1 rounded-full bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export default function NoteGalleryBlock({
  block,
  onChange,
  onFiles,
  busy,
}: {
  block: GalleryBlock;
  onChange: (patch: Partial<GalleryBlock>) => void;
  onFiles: (files: File[]) => void;
  busy?: boolean;
}) {
  const t = useT();
  const sensors = useSensors(
    // A few pixels of threshold: without them, clicking the delete cross would start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = block.images.map((image, i) => `${image.src}#${i}`);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const images = [...block.images];
    const [moved] = images.splice(from, 1);
    images.splice(to, 0, moved);
    onChange({ images });
  };

  return (
    <div className="space-y-2">
      {block.images.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            <div className={`grid gap-2 ${COLS[block.cols] ?? COLS[REFS_COLS.default]}`}>
              {block.images.map((image, i) => (
                <SortableThumb
                  key={ids[i]}
                  image={image}
                  index={i}
                  height={block.height}
                  onRemove={() => onChange({ images: block.images.filter((_, j) => j !== i) })}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <NoteImageDrop onFiles={onFiles} busy={busy} compact={block.images.length > 0} />

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          items={[
            { value: 'grid', label: t('note.gallery.grid'), icon: LayoutGrid, hint: t('note.gallery.grid') },
            {
              value: 'carousel',
              label: t('note.gallery.carousel'),
              icon: GalleryHorizontal,
              hint: t('note.gallery.carousel'),
            },
          ]}
          value={block.layout}
          onChange={(layout) => onChange({ layout })}
          iconOnly
          label={t('note.gallery.layout')}
        />
        {block.layout === 'grid' && (
          <>
            <NumberField
              label={t('note.gallery.columns')}
              value={block.cols}
              onChange={(cols) => onChange({ cols })}
              min={REFS_COLS.min}
              max={REFS_COLS.max}
              step={1}
            />
            <NumberField
              label={t('note.gallery.height')}
              value={block.height}
              onChange={(height) => onChange({ height })}
              min={REFS_HEIGHT.min}
              max={REFS_HEIGHT.max}
              step={10}
              unit="px"
            />
          </>
        )}
        <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
          {t('note.gallery.count', { count: block.images.length })}
        </span>
      </div>
    </div>
  );
}
