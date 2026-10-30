// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Scope of a menu action facing a multiple selection (A3).
 *
 * The rule was applied in one place, by hand: on the Reviews page, adding to a playlist took the
 * selection into account, deleting just below did not — and the other lists ignored it altogether.
 * A single tested rule now applies everywhere: **if the clicked item is part of the selection, the
 * action covers the whole selection; otherwise, only the clicked item.**
 */

/** Items the action must actually apply to. */
export function actionTarget(clickedId: number, selection: readonly number[]): number[] {
  return selection.length > 1 && selection.includes(clickedId) ? [...selection] : [clickedId];
}

/** True if the action will apply to several items: the label must then say so. */
export function isBulkTarget(clickedId: number, selection: readonly number[]): boolean {
  return actionTarget(clickedId, selection).length > 1;
}

/**
 * Label of an action, completed with the number of items targeted when there are several.
 * Nothing is concatenated by hand: the suffix is supplied translated by the caller.
 */
export function scopedLabel(label: string, count: number, countLabel: (n: number) => string): string {
  return count > 1 ? `${label} — ${countLabel(count)}` : label;
}
