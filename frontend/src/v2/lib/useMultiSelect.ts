// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';

/** Modificateurs de clic pertinents pour la sélection (sous-ensemble de MouseEvent). */
export interface SelectModifiers {
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export interface MultiSelect {
  /** Ids actuellement sélectionnés (ordre non garanti). */
  ids: number[];
  count: number;
  isSelected: (id: number) => boolean;
  /**
   * Clic sur une case / ligne. **Shift** étend la plage depuis la dernière ancre dans
   * l'ordre visuel ; sinon bascule l'id (Ctrl/Cmd = même comportement additif que la case).
   */
  onSelect: (id: number, mods?: SelectModifiers) => void;
  clear: () => void;
  /** Sélectionne tout l'ensemble visible / le vide s'il est déjà entièrement coché. */
  toggleAll: () => void;
  allSelected: boolean;
}

/**
 * Cœur pur de la sélection (testable sans renderer). Retourne le nouvel ensemble et
 * la nouvelle ancre. Shift étend la plage [ancre..id] dans l'ordre visuel ; sinon bascule.
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
      for (let i = lo; i <= hi; i++) next.add(orderedIds[i]!);
      return { next, anchor };
    }
  }
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { next, anchor: id };
}

/**
 * Multi-sélection générique pour les listes (13.A). `orderedIds` = ids dans l'ordre
 * d'affichage (nécessaire au Shift-clic par plage). Échap vide la sélection.
 */
export function useMultiSelect(orderedIds: number[]): MultiSelect {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const anchor = useRef<number | null>(null);
  // Ref sur l'ordre courant : évite de recréer onSelect à chaque rendu de liste.
  // Mise à jour en effet (interdiction d'écrire une ref pendant le rendu).
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

  // Échap vide la sélection (uniquement quand il y a une sélection active).
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
