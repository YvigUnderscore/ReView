// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { UNDO_PRIORITY, useUndoScope } from '../../lib/undoScope';

/**
 * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y on the annotation in progress — shapes **and** pasted references.
 *
 * The keyboard handler itself now lives in `lib/undoScope`, shared with the splat editor and the 3D
 * brush. This module now says only this: the composer is the **highest-priority** scope
 * (`UNDO_PRIORITY.composer`), and it claims the keystroke only if it really has a step to restore —
 * otherwise it falls back to the media's editor.
 *
 * Before this sharing, each history posted its own `keydown` on `document`: two histories with a step
 * meant that a single keystroke undid both.
 */
export function useAnnotationShortcuts({
  enabled,
  canUndo,
  canRedo,
  undo,
  redo,
}: {
  enabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}): void {
  useUndoScope({ enabled, priority: UNDO_PRIORITY.composer, canUndo, canRedo, undo, redo });
}
