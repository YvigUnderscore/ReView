// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReviewStatus } from '../types/api';

/**
 * Helpers purs de la décision de review (Phase 31) — testés isolément.
 * Les couleurs de statut sont des données studio (hex), pas des tokens de thème :
 * on dérive teinte/fond/bordure par suffixe alpha hex.
 */

/** Style inline d'un badge/bouton de statut (texte plein, fond ~12 %, bordure ~40 %). */
export function reviewStatusStyle(color: string, selected = false) {
  return {
    color,
    borderColor: `${color}66`,
    backgroundColor: selected ? `${color}2e` : `${color}1f`,
  };
}

/** Statut présélectionné dans le dialog : décision courante, sinon défaut studio, sinon null. */
export function pickPreselectedStatus(
  current: Pick<ReviewStatus, 'id'> | null,
  statuses: Pick<ReviewStatus, 'id' | 'isDefault'>[],
): number | null {
  return current?.id ?? statuses.find((s) => s.isDefault)?.id ?? null;
}
