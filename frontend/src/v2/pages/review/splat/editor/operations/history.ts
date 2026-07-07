import { useCallback, useMemo, useReducer, useRef } from 'react';

/** Opération d'édition annulable (déjà appliquée quand elle est poussée dans l'historique). */
export interface EditOp {
  label: string;
  undo(): void;
  redo(): void;
}

/**
 * Historique undo/redo de l'éditeur de splat (10.G) — pile classique : `push` après
 * application d'une opération (vide le futur), `undo`/`redo` dépilent en appelant les
 * callbacks. Cœur pur (testable sans React) ; le hook `useEditHistory` l'expose avec
 * re-rendu après chaque action.
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
    /** Annule toutes les opérations (réinitialisation complète de l'éditeur). */
    undoAll(): void {
      while (this.undo()) {
        /* dépile jusqu'au vide */
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
 * Wrapper React : mêmes actions (identités stables), avec re-rendu après chaque mutation.
 * L'objet renvoyé ne change que lorsque canUndo/canRedo changent.
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
