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
import type { ReactNode } from 'react';
import type { WidgetDragHandle } from './WidgetShell';

/**
 * Rearrange mode of a composable page — and the **only** module that knows @dnd-kit (F5).
 *
 * The three packages (core, sortable, utilities) weigh 16.8 kB gzip. They were in the entry
 * file, and so downloaded by everyone on every page, for an optional gesture: moving tiles.
 * They now arrive when entering edit mode, and the grid outside edit mode stays plain HTML —
 * sensors, collision detection and ARIA announcements included. Every page that uses it must
 * therefore import it through `lazy()`, never directly.
 *
 * Identifiers travel as `string`: the page knows its own registry, and it is the one that
 * discards what it does not recognise.
 */
export interface WidgetSortableProps {
  ids: string[];
  /** Grid classes, shared with the rendering outside edit mode: same layout. */
  className: string;
  onReorder: (from: string, to: string) => void;
  /** Renders a block; the third argument only exists in this mode. */
  renderWidget: (id: string, index: number, drag?: WidgetDragHandle) => ReactNode;
}

export default function WidgetSortable({ ids, className, onReorder, renderWidget }: WidgetSortableProps) {
  const sensors = useSensors(
    // A threshold of a few pixels: without it, a simple click on a block would start a
    // drag and swallow the click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className={className}>
          {ids.map((id, index) => (
            <SortableWidget key={id} id={id} index={index} renderWidget={renderWidget} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

/** A block rendered by `renderWidget`, augmented with what `useSortable` gives it. */
function SortableWidget({
  id,
  index,
  renderWidget,
}: {
  id: string;
  index: number;
  renderWidget: WidgetSortableProps['renderWidget'];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return renderWidget(id, index, {
    ref: setNodeRef,
    style: { transform: CSS.Translate.toString(transform), transition },
    dragging: isDragging,
    // dnd-kit's ARIA attributes and listeners, meant as-is for the handle.
    handleProps: { ...attributes, ...listeners },
  });
}
