// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EditOp } from '../operations/history';

/**
 * History steps for **mask selection** changes (Phase 50, lot 12).
 *
 * Only deletions, volumes and transforms were undoable: a badly drawn lasso, one brush stroke
 * too many, or an unlucky "deselect all" erased several minutes of work that nothing could
 * restore, even though Ctrl+Z was answering right beside it for the next operation. Selection
 * therefore joins the **same** history as edits (`operations/history`), at the same precedence
 * rank (`UNDO_PRIORITY.editor`): one stack, one order, and undoing a deletion also restores the
 * selection that produced it.
 *
 * The core is pure: this file knows neither what a splat is nor how the selection is applied;
 * it compares two sets and builds the operation.
 */

/** Do two selections contain exactly the same splats? */
export function sameSelection(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const index of a) if (!b.has(index)) return false;
  return true;
}

/**
 * History step of a selection change, or `null` when the gesture changed nothing: a click in
 * the void, a lasso that re-selects exactly the same splats, or a "deselect" on an already empty
 * selection must not consume a Ctrl+Z for nothing.
 */
export function selectionOp(
  label: string,
  before: ReadonlySet<number>,
  after: ReadonlySet<number>,
  apply: (selection: ReadonlySet<number>) => void,
): EditOp | null {
  if (sameSelection(before, after)) return null;
  return { label, undo: () => apply(before), redo: () => apply(after) };
}
