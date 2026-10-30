// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useReducer, useRef } from 'react';

/** Undoable edit operation (already applied when pushed onto the history). */
export interface EditOp {
  label: string;
  undo(): void;
  redo(): void;
}

/**
 * Undo/redo history of the splat editor (10.G): classic stack. `push` after applying an operation (empties
 * the future); `undo` / `redo` pop by calling the callbacks. Pure core (testable without React); the
 * `useEditHistory` hook exposes it with a re-render after each action.
 */
export function createHistory() {
  const past: EditOp[] = [];
  const future: EditOp[] = [];
  return {
    push(op: EditOp): void {
      past.push(op);
      future.length = 0;
    },
    undo(): boolean {
      const op = past.pop();
      if (!op) return false;
      op.undo();
      future.push(op);
      return true;
    },
    redo(): boolean {
      const op = future.pop();
      if (!op) return false;
      op.redo();
      past.push(op);
      return true;
    },
    /** Cancels all operations (complete reset of the editor). */
    undoAll(): void {
      while (this.undo()) {
        /* pops until empty */
      }
    },
    clear(): void {
      past.length = 0;
      future.length = 0;
    },
    get canUndo(): boolean {
      return past.length > 0;
    },
    get canRedo(): boolean {
      return future.length > 0;
    },
  };
}

export type EditHistory = ReturnType<typeof createHistory>;

/**
 * React wrapper: same actions (stable identities), with a re-render after each mutation. The returned
 * object only changes when canUndo / canRedo change.
 */
export function useEditHistory() {
  const historyRef = useRef<EditHistory | null>(null);
  historyRef.current ??= createHistory();
  const h = historyRef.current;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const push = useCallback(
    (op: EditOp) => {
      h.push(op);
      bump();
    },
    [h],
  );
  const undo = useCallback(() => {
    if (h.undo()) bump();
  }, [h]);
  const redo = useCallback(() => {
    if (h.redo()) bump();
  }, [h]);
  const undoAll = useCallback(() => {
    h.undoAll();
    bump();
  }, [h]);
  const clear = useCallback(() => {
    h.clear();
    bump();
  }, [h]);
  const { canUndo, canRedo } = h;
  return useMemo(
    () => ({ push, undo, redo, undoAll, clear, canUndo, canRedo }),
    [push, undo, redo, undoAll, clear, canUndo, canRedo],
  );
}
