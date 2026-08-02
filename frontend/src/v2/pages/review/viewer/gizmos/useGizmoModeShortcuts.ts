// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { isEditable } from '../../../../lib/shortcuts';
import type { GizmoMode } from './useTransformGizmo';

/** Mode de transformation du viewer 3D : navigation (aucun gizmo) ou gizmo TRS. */
export type TransformMode = 'navigate' | GizmoMode;

const MODE_KEYS: Record<string, TransformMode> = {
  v: 'navigate', // V = retour navigation (détache le gizmo)
  t: 'translate',
  r: 'rotate',
  s: 'scale',
};

/**
 * Raccourcis clavier de transformation unifiés (Phase 26) : V/T/R/S sélectionnent le mode
 * (navigate/translate/rotate/scale), **Échap → navigation** (détache le gizmo), Ctrl+Z / Ctrl+Y /
 * Ctrl+Maj+Z pilotent l'historique. Alignés sur l'éditeur splat (`useEditorShortcuts`) mais
 * dédiés au viewer 3D. Inertes dans les champs, les dialogues et pendant un vol.
 */
export function useGizmoModeShortcuts(opts: {
  enabled: boolean;
  isFlying: () => boolean;
  setMode: (m: TransformMode) => void;
  history: { undo: () => void; redo: () => void };
}): void {
  const { enabled, isFlying, setMode, history } = opts;
  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      if (isFlying()) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          history.undo();
        } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          history.redo();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setMode('navigate');
        return;
      }
      const next = MODE_KEYS[key];
      if (next) {
        e.preventDefault();
        setMode(next);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [enabled, isFlying, setMode, history]);
}
