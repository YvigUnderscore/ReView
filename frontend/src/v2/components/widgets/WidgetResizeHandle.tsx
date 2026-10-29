// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, MoveDiagonal2 } from 'lucide-react';
import type { WidgetSpan } from '../../lib/widgetLayout';
import {
  WIDGET_ROWS,
  gridGeometry,
  resizeTarget,
  stepSize,
  type WidgetRows,
  type WidgetSize,
} from './widgetSizing';
import { useT } from '../../i18n';

/**
 * The resize handle of a block — the gesture requested for the project overview (batch 12),
 * then word for word for the home page ("the same resize settings, of windows"). It therefore
 * lives with the common frame, and both pages mount it.
 *
 * It is the deliberate exception to the "right click first" rule: setting a size through a menu,
 * step by step, means setting a size without seeing it. So the corner is dragged, and the grid
 * follows under the cursor. It only appears in composition mode, like the move handle: outside
 * composition, the page stays a page.
 *
 * It is not decoration: it is a button, it takes focus, and the four arrow keys walk the same
 * steps as the mouse — left and right for the width, up and down for the height. Its accessible
 * name carries the current size, so that the result of the gesture is heard as well as seen.
 *
 * Dragging does **not** go through `onPreview` → save on every pixel: each step crossed would
 * write a preference, that is one request per step. The preview lives in the grid, and only
 * release saves.
 *
 * The labels stay under the `overview.widget.*` prefix, where they were born: they are word for
 * word the same messages end to end, and a key is not renamed for the sake of tidiness — it
 * would be renamed in fourteen catalogues without a single word changing on screen.
 * `WidgetShell`, also shared, likewise keeps its labels under `home.widget.*`.
 */

/** The four arrows, and what they adjust. */
const ARROWS: Record<string, { axis: 'span' | 'rows'; direction: -1 | 1 }> = {
  ArrowRight: { axis: 'span', direction: 1 },
  ArrowLeft: { axis: 'span', direction: -1 },
  ArrowDown: { axis: 'rows', direction: 1 },
  ArrowUp: { axis: 'rows', direction: -1 },
};

export interface WidgetResizeHandleProps {
  /** Block title: the handle announces itself by what it resizes. */
  name: string;
  size: WidgetSize;
  /** Widths this block offers — the bounding is the same with the mouse and the keyboard. */
  spans: WidgetSpan[];
  /** Size under the cursor during the drag; `null` when it ends. */
  onPreview: (size: WidgetSize | null) => void;
  /** Chosen size — saved once only, on release or on key press. */
  onCommit: (size: WidgetSize) => void;
}

const changed = (a: WidgetSize, b: WidgetSize) => a.span !== b.span || a.rows !== b.rows;

export default function WidgetResizeHandle({
  name,
  size,
  spans,
  onPreview,
  onCommit,
}: WidgetResizeHandleProps) {
  const t = useT();
  const handle = useRef<HTMLButtonElement | null>(null);

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const origin = { x: event.clientX, y: event.clientY };
    // The grid step is read from the block's container, that is the grid itself:
    // it carries the computed columns and the row height.
    const geometry = gridGeometry(handle.current?.closest('section[data-widget]')?.parentElement ?? null);
    let target = size;

    const move = (moved: PointerEvent) => {
      target = resizeTarget(
        size,
        { dx: moved.clientX - origin.x, dy: moved.clientY - origin.y },
        geometry,
        spans,
      );
      onPreview(target);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      onPreview(null);
      if (changed(target, size)) onCommit(target);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    event.preventDefault();
    const next = stepSize(size, arrow.axis, arrow.direction, spans);
    if (changed(next, size)) onCommit(next);
  };

  return (
    <button
      ref={handle}
      type="button"
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      aria-label={t('overview.widget.resize', { name, width: size.span, height: size.rows })}
      title={t('overview.widget.resizeHint')}
      className="absolute bottom-1 right-1 cursor-nwse-resize rounded-sm bg-card/80 p-1 text-muted-foreground transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MoveDiagonal2 size={13} />
    </button>
  );
}

/**
 * The same height setting, in the panel: the handle shows the result, the list shows the
 * scale. One without the other would leave either a gesture impossible to find, or a setting
 * impossible to aim at.
 */
export function WidgetRowsChoice({ rows, onRows }: { rows: WidgetRows; onRows: (rows: WidgetRows) => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1">
      {WIDGET_ROWS.map((value) => (
        <button
          key={value}
          onClick={() => onRows(value)}
          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${
            value === rows
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
        >
          {value === rows && <Check size={11} />}
          {t('overview.widget.rows', { count: value })}
        </button>
      ))}
    </div>
  );
}
