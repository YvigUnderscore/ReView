// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { isEditable } from './shortcuts';

/**
 * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y: **a single** handler for the whole application.
 *
 * Each screen that holds a local history registers with it (`useUndoScope`) instead of
 * adding its own `keydown`. That was the defect: three handlers already listened to the same keys
 * on a splat (the annotation composer, the splat editor, the camera animation), each
 * called `preventDefault()` without telling the others it had taken the keystroke, and a single
 * press undid **two** things as soon as two histories had a step to revert. The
 * written convention "I only capture if I really have a step" was not enough: it
 * settles nothing when both have one.
 *
 * The tie-break is therefore explicit, by PRIORITY (`UNDO_PRIORITY`) and not by mount order:
 * the keystroke goes to the highest-priority scope that actually has a step to undo, and to it
 * alone. Effect mount order = component order, that is to say a matter of chance in
 * composition: the gesture the user has in hand does not follow from it.
 *
 * Two guards kept from the existing code: never in an input field (the browser's Ctrl+Z
 * does a better job there), never while a dialog is open. And an event already handled
 * (`defaultPrevented`) is left alone: this is how the layout workshop keeps control
 * (`camera/useCameraShortcuts` listens in the capture phase and stops propagation).
 */

/** What a keystroke asks of the history. */
export type UndoAction = 'undo' | 'redo';

/**
 * Scope priorities. Higher = served first.
 *
 * The order follows what the user has in hand: a comment being written comes before
 * the media editor, because one cannot annotate and edit in the same gesture,
 * and the stroke is what was just done. The editor brings up the rear: it is the fallback.
 */
export const UNDO_PRIORITY = {
  /** Annotation in progress: 2D shapes and pasted references (image/video review). */
  composer: 30,
  /** 3D surface brush strokes in progress (splat). */
  brush3d: 20,
  /** Non-destructive media editing: mask, volumes, transform. */
  editor: 10,
} as const;

/** A history candidate for the keystroke. */
export interface UndoScope {
  priority: number;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

/** What the keystroke asks, or `null` if it does not concern history. Pure function. */
export function undoIntent(
  e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>,
): UndoAction | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  // Ctrl+Y is Windows' redo; Ctrl+Shift+Y is nobody's shortcut.
  if (key === 'y' && !e.shiftKey) return 'redo';
  return null;
}

/** The scope served: the highest-priority one that really has a step to revert. Pure function. */
export function pickScope(scopes: Iterable<UndoScope>, action: UndoAction): UndoScope | null {
  let best: UndoScope | null = null;
  for (const scope of scopes) {
    if (!(action === 'undo' ? scope.canUndo : scope.canRedo)) continue;
    if (best === null || scope.priority > best.priority) best = scope;
  }
  return best;
}

/** Registered scopes. Refs, so that `canUndo` can change without re-registering. */
const registered = new Set<{ current: UndoScope }>();
let listening = false;

/** Applies the keystroke: exported for the test, which has no DOM to listen to. */
export function dispatchUndoKey(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const action = undoIntent(e);
  if (action === null) return;
  if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
  const scope = pickScope(
    [...registered].map((ref) => ref.current),
    action,
  );
  if (scope === null) return;
  e.preventDefault();
  if (action === 'undo') scope.undo();
  else scope.redo();
}

/**
 * Registers this screen's history. `enabled` says whether the gesture is in the reader's hands;
 * `canUndo`/`canRedo` say whether a step remains: an empty scope lets the keystroke pass to the
 * next one, exactly as before.
 */
export function useUndoScope(scope: UndoScope & { enabled: boolean }): void {
  const ref = useRef(scope);
  // Mirror updated on every render, read only from the keyboard handler.
  useEffect(() => {
    ref.current = scope;
  });

  const enabled = scope.enabled;
  useEffect(() => {
    if (!enabled) return;
    registered.add(ref);
    if (!listening) {
      listening = true;
      document.addEventListener('keydown', dispatchUndoKey);
    }
    return () => {
      registered.delete(ref);
      if (registered.size === 0 && listening) {
        listening = false;
        document.removeEventListener('keydown', dispatchUndoKey);
      }
    };
  }, [enabled]);
}
