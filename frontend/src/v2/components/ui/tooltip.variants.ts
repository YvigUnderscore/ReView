// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cn } from '../../lib/utils';

/**
 * Tooltip settings and styling, isolated from the component so they can be checked without
 * rendering (same split as `button.variants.ts` / `card.variants.ts`).
 *
 * ## The delay is a product choice
 *
 * The native browser tooltip waits ~1.5 s. On an icon-only button, where it is the only thing
 * that says what the button does, that wait is the defect itself: the user who asks "what is
 * this?" pays a second and a half to find out.
 *
 * Hence **250 ms**: below the ~400 ms threshold where an interface stops feeling immediate,
 * but above the ~150 ms of a passing hover — otherwise sweeping a dense transport bar makes a
 * tooltip flash for every button crossed.
 *
 * `TOOLTIP_SKIP_DELAY_MS` complements it: once one tooltip is open, the following ones show
 * **without delay** within this window. This is what makes a dense bar readable — it is swept,
 * not queried button by button.
 */
export const TOOLTIP_DELAY_MS = 250;

/** Window during which the next tooltip opens immediately (see above). */
export const TOOLTIP_SKIP_DELAY_MS = 500;

/**
 * A missing label mounts no tooltip at all.
 *
 * Callers often pass an optional value (`shortcut`, computed label); without this filter, an
 * empty string would open an empty panel on hover. Whitespace alone counts as absent — it gives
 * nothing to read.
 */
export function shouldRenderTooltip(label: unknown): boolean {
  if (label === undefined || label === null || label === false) return false;
  if (typeof label === 'string') return label.trim().length > 0;
  return true;
}

/**
 * Panel styling.
 *
 * Two points the tests lock:
 *
 *  1. **`z-[60]`, not `z-50`.** All the floating layers in the folder (dialog, sheet,
 *     popover, context-menu, lightbox) are at `z-50`. A tooltip triggered from a modal
 *     header button is portalled to `body` like the modal itself: at equal `z-index`, only
 *     DOM order decides, and it depends on the mounting order. One step higher makes the
 *     result independent of that order. `z-[60]` is already the repo's "above everything"
 *     step (see `FullPageDropzone`).
 *  2. **`data-[state=delayed-open]` / `data-[state=instant-open]`, never `data-[state=open]`.**
 *     Radix Tooltip does not write `open` into its `data-state`, unlike the popover and the
 *     dialog: copying the popover classes gives a panel that never animates its entry. Both
 *     states are covered, the immediate opening (grace window above) as well as the delayed one.
 */
export function tooltipContentClass(className?: string): string {
  return cn(
    'z-[60] max-w-xs rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground shadow-xl',
    'data-[state=delayed-open]:animate-in data-[state=instant-open]:animate-in data-[state=closed]:animate-out',
    'data-[state=delayed-open]:fade-in-0 data-[state=instant-open]:fade-in-0 data-[state=closed]:fade-out-0',
    'data-[state=delayed-open]:zoom-in-95 data-[state=instant-open]:zoom-in-95 data-[state=closed]:zoom-out-95',
    className,
  );
}
