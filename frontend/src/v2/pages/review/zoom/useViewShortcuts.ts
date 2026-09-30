// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { isEditable } from '../../../lib/shortcuts';

/** Les deux commandes de vue des viewers plats — celles que le rail nomme `fit` et `reset`. */
export interface ViewCommands {
  /** Ajuster à l'écran (`F`). */
  fit: () => void;
  /** Taille réelle, un pixel média pour un pixel écran (`H`). */
  oneToOne: () => void;
}

/**
 * `F` / `H` sur les deux viewers plats — le pendant de `useFrameShortcuts`, qui rend le même
 * service en 3D et en splat.
 *
 * Les deux actions de vue étaient **déclarées** dans `chrome/tools.ts` (`action.fitMedia`,
 * `action.resetMedia`) et branchées nulle part : sur une image comme sur une vidéo, les deux
 * lettres ne faisaient rien. Elles remplacent aussi `0` et `1`, que le zoom du lecteur écoutait
 * : `1` ajustait l'échelle **et** basculait sur le premier mode de la bascule, deux réponses
 * pour une frappe.
 *
 * `null` désarme le hook — un pane de comparaison ne doit pas répondre à ces touches en plus du
 * viewer principal.
 */
export function useViewShortcuts(commands: ViewCommands | null): void {
  // Miroir : les fonctions changent d'identité à chaque rendu du viewer, l'abonnement non.
  const ref = useRef(commands);
  useEffect(() => {
    ref.current = commands;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = ref.current;
      if (!cmd) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'f') cmd.fit();
      else if (key === 'h') cmd.oneToOne();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
