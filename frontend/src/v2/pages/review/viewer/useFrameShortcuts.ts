// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { isEditable } from '../../../lib/shortcuts';

/**
 * Raccourcis de cadrage communs aux viewers 3D/splat (Phase 17) : `F` cadre la sélection ou
 * l'objet, `H` rétablit la vue d'origine. Inertes pendant un vol (clic droit + ZQSD), dans les
 * champs de saisie, les dialogues, ou avec un modificateur enfoncé — même garde que le splat.
 */
export function useFrameShortcuts(opts: {
  active: boolean;
  isFlying: () => boolean;
  onFrame: () => void;
  onHome: () => void;
}) {
  const { active, isFlying, onFrame, onHome } = opts;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      if (isFlying() || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f') {
        e.preventDefault();
        onFrame();
      } else if (k === 'h') {
        e.preventDefault();
        onHome();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, isFlying, onFrame, onHome]);
}
