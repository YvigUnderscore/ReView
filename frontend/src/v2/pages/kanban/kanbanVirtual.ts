// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Arithmetic of the virtualized column (wave 2, scale).
 *
 * A kanban column mounted up to sixty cards, then stopped at an "and forty others" that no gesture
 * could reach. On a feature film (two thousand shots, ten thousand tasks), half of the studio's
 * work was out of reach, and the sixty mounted cards each carried a dnd-kit record and a Radix
 * context menu.
 *
 * The column now scrolls on its own and mounts only its visible window. Decisions that do not
 * need the DOM are isolated here, so they can be verified without a browser.
 */

/**
 * Below this number, the column is mounted in full.
 *
 * Virtualizing costs a size observer per card and a measurement per render. Below about thirty
 * cards, the visible window is roughly the whole column, and the screen of a small project stays
 * exactly what it was.
 */
export const VIRTUALIZE_FROM = 30;

/** Estimated height of a card, gutter included, remeasured afterwards for real. */
export const CARD_ESTIMATE = 64;

/** Cards mounted on each side of the window: scrolling shows no gap. */
export const CARD_OVERSCAN = 6;

/** A column dense enough to deserve virtualization. */
export function shouldVirtualize(count: number): boolean {
  return count > VIRTUALIZE_FROM;
}

/**
 * Position of the card being dragged within the column, `-1` if it is not there.
 *
 * The board only knows an identifier: each column checks whether it is its own.
 */
export function activeIndexIn(tasks: readonly { id: number }[], activeTaskId: number | null): number {
  if (activeTaskId == null) return -1;
  return tasks.findIndex((task) => task.id === activeTaskId);
}

/**
 * Forces the dragged card to stay mounted, even when it has left the visible window.
 *
 * Without it, scrolling the column during a drag would unmount the card held by the mouse: the
 * drop zone (the column) would still hold, but the preview followed by the cursor would lose its
 * reference size, and the original card would stop being greyed out.
 * The index comes back sorted, since the virtualizer assumes an ascending window.
 */
export function withActiveIndex(indices: readonly number[], activeIndex: number): number[] {
  if (activeIndex < 0 || indices.includes(activeIndex)) return [...indices];
  const merged = [...indices, activeIndex];
  merged.sort((a, b) => a - b);
  return merged;
}
