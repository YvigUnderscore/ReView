// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';

/**
 * La scène proposée par un commentaire reste appliquée après un mouvement de vue (46.T) : on
 * peut naviguer dans la scène modifiée, et Échap la relâche — même touche que le retour à
 * l'outil de repos, même sémantique de « repos ».
 *
 * La frappe est ignorée pendant une saisie de texte : Échap y annule le champ, pas la scène.
 * Extrait de `Model3DReview` (budget de lignes).
 */
export function useCommentSceneEscape(active: boolean, release: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
      if (e.key === 'Escape') release();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, release]);
}
