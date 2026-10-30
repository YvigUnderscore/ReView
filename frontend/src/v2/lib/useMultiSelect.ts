// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';

/** Click modifiers relevant to selection (subset of MouseEvent). */
export interface SelectModifiers {
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export interface MultiSelect {
  /** Ids currently selected (order not guaranteed). */
  ids: number[];
  count: number;
  isSelected: (id: number) => boolean;
  /**
   * Click on a checkbox / row. **Shift** extends the range from the last anchor in
   * visual order; otherwise toggles the id (Ctrl/Cmd = same additive behaviour as the checkbox).
   */
  onSelect: (id: number, mods?: SelectModifiers) => void;
  clear: () => void;
  /** Selects everything visible / clears it if it is already fully ticked. */
  toggleAll: () => void;
  allSelected: boolean;
}

/**
 * Pure core of the selection (testable without a renderer). Returns the new set and
 * the new anchor. Shift extends the range [anchor..id] in visual order; otherwise toggles.
 */
export function computeSelection(
  current: Set<number>,
  orderedIds: number[],
  id: number,
  anchor: number | null,
  mods?: SelectModifiers,
): { next: Set<number>; anchor: number | null } {
  const next = new Set(current);
  if (mods?.shiftKey && anchor != null) {
    const a = orderedIds.indexOf(anchor);
    const b = orderedIds.indexOf(id);
    if (a !== -1 && b !== -1) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      for (let i = lo; i <= hi; i++) next.add(orderedIds[i]);
      return { next, anchor };
    }
  }
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { next, anchor: id };
}

/**
 * Generic multi-selection for lists (13.A). `orderedIds` = ids in display order
 * (needed for range Shift-click). Escape clears the selection.
 */
export function useMultiSelect(orderedIds: number[]): MultiSelect {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const anchor = useRef<number | null>(null);
  // Ref on the current order: avoids recreating onSelect on each list render.
  // Updated in an effect (writing a ref during render is forbidden).
  const orderRef = useRef(orderedIds);
  useEffect(() => {
    orderRef.current = orderedIds;
  }, [orderedIds]);

  const clear = useCallback(() => {
    setSelected((prev) => (prev.size === 0 ? prev : new Set()));
    anchor.current = null;
  }, []);

  const onSelect = useCallback((id: number, mods?: SelectModifiers) => {
    setSelected((prev) => {
      const { next, anchor: nextAnchor } = computeSelection(prev, orderRef.current, id, anchor.current, mods);
      anchor.current = nextAnchor;
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const order = orderRef.current;
      if (order.length > 0 && order.every((id) => prev.has(id))) return new Set();
      return new Set(order);
    });
  }, []);

  // Escape clears the selection (only when there is an active selection).
  useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.size, clear]);

  const allSelected = orderedIds.length > 0 && orderedIds.every((id) => selected.has(id));

  return {
    ids: [...selected],
    count: selected.size,
    isSelected: (id: number) => selected.has(id),
    onSelect,
    clear,
    toggleAll,
    allSelected,
  };
}
