// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { isEditable } from '../../lib/shortcuts';

/**
 * Ctrl+Z / Ctrl+Maj+Z / Ctrl+Y sur l'annotation en cours — formes **et** références collées.
 *
 * Le raccourci n'est capté que s'il y a vraiment un cran à défaire : sinon il repart vers
 * l'éditeur qui écoute peut-être le même geste (splat, animation caméra), et deux historiques
 * ne se défont pas d'une seule frappe.
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
  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        if (!canUndo) return;
        e.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        if (!canRedo) return;
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [enabled, canUndo, canRedo, undo, redo]);
}
