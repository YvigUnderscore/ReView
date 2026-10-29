// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { memo, useCallback, useRef } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import KanbanCard from './KanbanCard';
import {
  CARD_ESTIMATE,
  CARD_OVERSCAN,
  activeIndexIn,
  shouldVirtualize,
  withActiveIndex,
} from './kanbanVirtual';
import type { MenuEntry } from '../../lib/menuSpec';
import type { BoardTask } from './kanbanTypes';

/**
 * A column's card stack (wave 2, scale).
 *
 * The column scrolls on its own: beyond its height, one scrolls through it without carrying the
 * whole page along, and above all without mounting the thousand cards it contains. Below about
 * thirty cards the simple list is kept: the visible window would in any case be the whole column,
 * and nothing changes for a small project.
 *
 * The height no longer comes from a percentage of the WINDOW: it comes from the board (Phase 50).
 * Each column used to take 68% of the screen height and up to five families stacked up: the board
 * overflowed by three screens, and the page had to be scrolled to reach the next family. The stack
 * now takes the space the board leaves it (`flex-1 min-h-0`), and nothing overflows.
 *
 * `overscroll-contain` went away with it: it cut the wheel chaining, so a wheel gesture on a dense
 * column did nothing at all once the stack was at its end.
 */

interface CardListProps {
  tasks: BoardTask[];
  menuFor?: (task: BoardTask) => MenuEntry[];
  /** Card held by the mouse, kept mounted even when out of the window. */
  activeTaskId?: number | null;
}

/** The stack takes the height the column leaves it, and scrolls inside it. */
const SCROLL = 'min-h-0 flex-1 overflow-y-auto';

const PlainCardList = memo(function PlainCardList({ tasks, menuFor }: CardListProps) {
  return (
    <div className={`${SCROLL} space-y-2`}>
      {tasks.map((task) => (
        <KanbanCard key={task.id} task={task} menuFor={menuFor} />
      ))}
    </div>
  );
});

const VirtualCardList = memo(function VirtualCardList({
  tasks,
  menuFor,
  activeTaskId = null,
}: CardListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIndex = activeIndexIn(tasks, activeTaskId);
  const rangeExtractor = useCallback(
    (range: Range) => withActiveIndex(defaultRangeExtractor(range), activeIndex),
    [activeIndex],
  );
  // The React compiler gives up memoizing a component that calls `useVirtualizer`: the virtualizer
  // returns functions bound to mutable state, which would be wrongly frozen.
  // This is harmless here: the list is memoized by hand (`memo` above) and only emits tasks, never
  // a virtualizer function.
  // eslint-disable-next-line react-hooks/incompatible-library -- explicit memoization, see above
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_ESTIMATE,
    overscan: CARD_OVERSCAN,
    getItemKey: (index) => tasks[index].id,
    rangeExtractor,
  });

  return (
    <div ref={scrollRef} className={SCROLL}>
      {/* Spacer sized to the stack's real height: the scrollbar reflects the true volume. */}
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full pb-2"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            <KanbanCard task={tasks[item.index]} menuFor={menuFor} />
          </div>
        ))}
      </div>
    </div>
  );
});

export default function KanbanCardList(props: CardListProps) {
  return shouldVirtualize(props.tasks.length) ? <VirtualCardList {...props} /> : <PlainCardList {...props} />;
}
