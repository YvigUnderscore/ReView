// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { isEditable } from '@/v2/lib/shortcuts';
import { UNDO_PRIORITY, useUndoScope } from '@/v2/lib/undoScope';
import { isHidden, parseClonePath, type SceneOverride } from './sceneOverride';
import type { UsdSceneState } from './useUsdScene';
import { useT } from '@/v2/i18n';

/**
 * Keyboard rearrangement of the USD scene (batch 13): **Delete** hides the selection, and
 * **Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y** undo that rearrangement.
 *
 * Three repository rules drive this implementation:
 *
 *  1. **Hide, don't delete.** The original USD file is never rewritten: `Delete` sets
 *     `visible: false` in the ReView override, a non-destructive layer replayed at load time
 *     (46.B). Hence the name of the history step — "Hide", not "Delete".
 *  2. **One history per keystroke.** The 3D screen already has several (annotation in progress,
 *     camera animation): we register in the batch 9 precedence registry (`lib/undoScope`) at the
 *     FALLBACK rank (`UNDO_PRIORITY.editor`), on the history the viewer already keeps for its gizmos
 *     (`useModel3DChrome`). No fourth stack: a hide and a prim move are undone in the order they
 *     were made.
 *  3. **No promotion on write.** A click in the viewer designates the enclosing `component`
 *     (batch 6), the tree and Alt+click designate the leaf: `Delete` hides exactly the paths the
 *     selection carries, without climbing or descending. What is highlighted is what disappears,
 *     and that is the path the override records.
 */

/** What `Delete` is going to write: a prim to hide, and the value to restore on undo. */
export interface HideStep {
  path: string;
  /** `visible` the local exploration held before — `undefined` = no instruction. */
  before: boolean | undefined;
}

/**
 * Prims that `Delete` must hide, taken from the selection as is. Pure function.
 *
 * Two exclusions. A prim **already invisible** (on its own or by a hidden ancestor) gives no step:
 * hiding it a second time would change nothing on screen while dirtying the delta. A **staging
 * clone** (`/prim#id`) cannot be hidden — it is an override copy, removed through its context menu;
 * confusing it with its source prim would make the original disappear.
 */
export function planHide(
  selected: readonly string[],
  override: SceneOverride,
  local: SceneOverride,
): HideStep[] {
  const steps: HideStep[] = [];
  for (const path of selected) {
    if (parseClonePath(path) || isHidden(override, path)) continue;
    steps.push({ path, before: local.prims[path]?.visible });
  }
  return steps;
}

/** The viewer's history, seen from here: we push a step onto it, and replay it. */
interface SceneHistory {
  push: (op: { label: string; undo: () => void; redo: () => void }) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useSceneEditShortcuts(opts: {
  /** USD scene of the media — absent when the model is not one. */
  scene?: UsdSceneState;
  /** 3D viewer history: gizmos (46.N) and, now, prim hides. */
  history: SceneHistory;
  /**
   * `Delete` is ours. False when the curve editor is open: it deletes the selected keys with the
   * same key, and that is the one the user is looking at.
   */
  deleteEnabled: boolean;
  /** Ongoing flight (right button held): the keys drive the camera, not the scene. */
  isFlying: () => boolean;
}): void {
  const { scene, history, deleteEnabled, isFlying } = opts;
  const t = useT();

  // The viewer's history takes the keystroke at fallback rank: the camera workshop (capture
  // phase) and the annotation composer go first, exactly as on a splat.
  useUndoScope({
    enabled: true,
    priority: UNDO_PRIORITY.editor,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: history.undo,
    redo: history.redo,
  });

  // Read-back mirror in the keyboard handler: selection and override change on every render;
  // the handler must not be re-registered because of it.
  const ref = useRef({ scene, history, t });
  useEffect(() => {
    ref.current = { scene, history, t };
  });

  useEffect(() => {
    if (!deleteEnabled) return;
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      if (isFlying()) return;
      const { scene: s, history: h, t: tr } = ref.current;
      if (!s) return;
      const steps = planHide(s.selected, s.override, s.localDelta);
      if (steps.length === 0) return;
      e.preventDefault();
      const { setPrim } = s;
      const apply = () => {
        for (const step of steps) setPrim(step.path, { visible: false });
      };
      apply();
      h.push({
        label: tr('common.hide'),
        undo: () => {
          for (const step of steps) setPrim(step.path, { visible: step.before });
        },
        redo: apply,
      });
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [deleteEnabled, isFlying]);
}
