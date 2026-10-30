// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UsdBakedVariant } from '@/v2/types/usd';

/**
 * Availability of a variant option in review (46.P).
 *
 * Instant switching relies on **baking**: only an option present in the GLB can be shown without
 * reconversion. The menu greys out the others instead of offering a choice with no effect — that
 * was the symptom "texture variants don't work".
 */
export function variantOptionAvailable(
  baked: readonly UsdBakedVariant[] | null | undefined,
  prim: string,
  set: string,
  option: string,
  selected: string,
): boolean {
  // The option composed at conversion is already the base scene: always displayable.
  if (option === selected) return true;
  // Media converted before the list of baked options was exposed: we don't know —
  // do not block (fixtures from before 46.P work without this information).
  if (!baked) return true;
  return baked.some((b) => b.prim === prim && b.set === set && b.option === option);
}
