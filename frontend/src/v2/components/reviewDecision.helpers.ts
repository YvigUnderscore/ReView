// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReviewStatus } from '../types/api';
import { statusSwatch } from '../lib/contrast';

/**
 * Helpers purs de la décision de review (Phase 31) — testés isolément.
 * Les couleurs de statut sont des données studio (hex), pas des tokens de thème.
 */

/**
 * Style inline d'un badge/bouton de statut : la teinte studio porte le fond et la bordure,
 * le texte est ramené au seuil de lisibilité du thème courant (A2). Auparavant la couleur
 * brute servait aussi de couleur de texte — un statut sombre disparaissait sur le thème
 * bleu nuit, un statut pâle sur le thème clair.
 */
export function reviewStatusStyle(color: string, isDark: boolean, selected = false) {
  const swatch = statusSwatch(color, isDark);
  if (!swatch) return { color, borderColor: `${color}66`, backgroundColor: `${color}1f` };
  return {
    color: swatch.color,
    borderColor: swatch.borderColor,
    // Sélection : même teinte, un peu plus dense, pour rester distinguable au clavier.
    backgroundColor: selected
      ? swatch.backgroundColor.replace(/ \/ [\d.]+\)$/, ' / 0.28)')
      : swatch.backgroundColor,
  };
}

/** Statut présélectionné dans le dialog : décision courante, sinon défaut studio, sinon null. */
export function pickPreselectedStatus(
  current: Pick<ReviewStatus, 'id'> | null,
  statuses: Pick<ReviewStatus, 'id' | 'isDefault'>[],
): number | null {
  return current?.id ?? statuses.find((s) => s.isDefault)?.id ?? null;
}
