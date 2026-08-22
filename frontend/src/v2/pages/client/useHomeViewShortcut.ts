// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { isEditable } from '../../lib/shortcuts';

/**
 * `H` = retour à la vue d'origine, seul raccourci offert au spectateur d'un partage.
 *
 * L'invité n'a ni palette ni menu : la règle « UI simple » veut qu'une action passe par un
 * raccourci plutôt que par un bouton, et le clic droit est déjà pris par le vol libre des
 * viewers spatiaux. Inerte pendant la saisie d'un commentaire — écrire « hauteur » ne doit
 * pas recadrer la scène.
 */
export function useHomeViewShortcut(homeView: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() !== 'h' || isEditable(e.target)) return;
      e.preventDefault();
      homeView();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [homeView, enabled]);
}
