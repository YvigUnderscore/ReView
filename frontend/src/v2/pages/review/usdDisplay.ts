// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UsdModelInfo, UsdVariantSelection } from '../../types/api';
import { t } from '../../i18n';

/**
 * Display logic shared by `UsdSceneGroup` (USD section of the tech sheet) and `UsdRecomposeGroup`
 * (Phase 45, 45.F). Extracted here so that it is testable and exists only once: both components must
 * show **the same** current variant value, and the same word for the purpose read back before
 * recomposing.
 */

/** Readable label of the scene scale (USD `metersPerUnit`). */
export function unitLabel(metersPerUnit: number): string {
  if (metersPerUnit === 1) return t('usd.metre');
  if (metersPerUnit === 0.01) return t('usd.centimetre');
  if (metersPerUnit === 0.001) return t('usd.millimetre');
  return `${metersPerUnit} m`;
}

/** Label of the USD purpose — "Proxy" is the format's own word, it is not translated. */
export function purposeLabel(purpose: string): string {
  if (purpose === 'render') return t('viewer.render.title');
  if (purpose === 'proxy') return 'Proxy';
  if (purpose === 'guide') return t('usd.purposeGuide');
  return purpose;
}

/**
 * Current value of a variant set: the selection applied at conversion takes precedence over the one
 * carried by the scene itself.
 */
export function variantValue(
  selection: UsdVariantSelection,
  prim: string,
  name: string,
  fallback: string,
): string {
  return selection[prim]?.[name] ?? fallback;
}

/** Initial state of the dialog: one choice per variant set, aligned with the display. */
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
