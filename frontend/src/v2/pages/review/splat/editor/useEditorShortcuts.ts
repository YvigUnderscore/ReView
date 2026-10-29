// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { isEditable } from '@/v2/lib/shortcuts';
import { UNDO_PRIORITY, useUndoScope } from '@/v2/lib/undoScope';
import type { SplatViewer } from '../useSplat';

/**
 * Keyboard shortcuts of the splat editor: F/H (frame the selection / original view), Delete
 * (delete the selection), Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y (history). Inactive in fields, dialogs
 * and during a fly (right click + ZQSD: the keys drive the camera).
 *
 * The tool choice no longer goes through here: since the chrome redesign, the rail arms it
 * (`useChromeState`), and only it, so that the letter and the button never diverge.
 *
 * History no longer goes through this handler: it registers in the shared registry
 * (`lib/undoScope`) at the FALLBACK rank (`UNDO_PRIORITY.editor`). This is what arbitrates
 * between the editor and the 3D brush and the annotation composer, which listen to the same
 * keys: before, two non-empty histories were undone together on a single keypress. Accepted
 * corollary: the fly no longer blocks history. The fly guard protects the keys the fly **uses**
 * (ZQSD, and therefore F/H/Delete by proximity); Ctrl+Z is not one of them, and refusing to undo
 * because a right button is held never served anyone.
 */
export function useEditorShortcuts(opts: {
  enabled: boolean;
  splat: SplatViewer;
  history: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
  deleteSelection: () => void;
  frameSelection: () => void;
  frameHome: () => void;
}): void {
  const { enabled, splat, history, deleteSelection, frameSelection, frameHome } = opts;

  useUndoScope({
    enabled,
    priority: UNDO_PRIORITY.editor,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: history.undo,
    redo: history.redo,
  });

  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      if (splat.isFlying()) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        frameSelection();
        return;
      }
      if (key === 'h') {
        e.preventDefault();
        frameHome();
        return;
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [enabled, splat, deleteSelection, frameSelection, frameHome]);
}
