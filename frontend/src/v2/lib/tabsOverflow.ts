// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Splits a tab bar between what fits and what goes into the "…" menu (A1).
 *
 * Pure functions: the DOM measurement stays in the component, the decision is testable.
 * Eleven tabs on the project page do not fit below 1000 px; without a fallback, the bar overflowed and
 * made the whole page scroll sideways.
 */

/**
 * Number of tabs that can be displayed. If not everything fits, the room for the "…" button is
 * reserved first — otherwise the last visible tab would push it out of the frame.
 */
export function computeVisibleTabs(
  widths: number[],
  gap: number,
  container: number,
  moreWidth: number,
): number {
  if (widths.length === 0) return 0;
  // Container not yet measured: show everything, the next measurement will correct it.
  if (container <= 0) return widths.length;

  const total = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
  if (total <= container) return widths.length;

  const budget = container - moreWidth - gap;
  let used = 0;
  let visible = 0;
  for (const w of widths) {
    const next = used + w + (visible > 0 ? gap : 0);
    if (next > budget) break;
    used = next;
    visible += 1;
  }
  return visible;
}

/**
 * Splits the list into visible / overflow. The active tab always stays reachable in one click: if it
 * falls into the overflow, it takes the last visible slot and the displaced tab goes to its position in
 * the menu (the relative order of the menu is kept).
 */
export function splitTabs<T>(
  items: T[],
  visibleCount: number,
  activeIndex: number,
): { visible: T[]; overflow: T[] } {
  if (visibleCount >= items.length) return { visible: [...items], overflow: [] };

  const visible = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);
  if (visibleCount > 0 && activeIndex >= visibleCount && activeIndex < items.length) {
    const displaced = visible[visibleCount - 1];
    visible[visibleCount - 1] = items[activeIndex];
    overflow[activeIndex - visibleCount] = displaced;
  }
  return { visible, overflow };
}
