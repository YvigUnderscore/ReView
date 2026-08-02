// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UsdModelInfo, UsdVariantSelection } from '../../types/api';
import { t } from '../../i18n';

/**
 * Logique d'affichage partagée entre la section USD de la fiche technique et le dialogue de
 * recomposition (Phase 45, 45.F). Extraite ici pour être testable et n'exister qu'une fois :
 * les deux composants doivent afficher **la même** valeur courante de variante.
 */

/** Libellé lisible de l'échelle de scène (`metersPerUnit` USD). */
export function unitLabel(metersPerUnit: number): string {
  if (metersPerUnit === 1) return t('usd.metre');
  if (metersPerUnit === 0.01) return t('usd.centimetre');
  if (metersPerUnit === 0.001) return t('usd.millimetre');
  return `${metersPerUnit} m`;
}

/**
 * Valeur courante d'un jeu de variantes : la sélection appliquée à la conversion prime sur
 * celle portée par la scène elle-même.
 */
export function variantValue(
  selection: UsdVariantSelection,
  prim: string,
  name: string,
  fallback: string,
): string {
  return selection[prim]?.[name] ?? fallback;
}

/** État initial du dialogue : un choix par jeu de variantes, aligné sur l'affichage. */
export function initialSelection(usd: UsdModelInfo): UsdVariantSelection {
  const initial: UsdVariantSelection = {};
  for (const set of usd.variantSets) {
    initial[set.prim] = {
      ...(initial[set.prim] ?? {}),
      [set.name]: variantValue(usd.selection.variants, set.prim, set.name, set.selected),
    };
  }
  return initial;
}
