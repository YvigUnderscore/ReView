// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BulkDeleteDomain } from '../../lib/bulkApi';

/**
 * Trash selection, **across all sections**.
 *
 * Each section used to have its own: ticking "all" in the shots touched neither the sequences, nor
 * the assets, nor the versions. Emptying an end-of-project trash therefore required six passes, and
 * one had to remember all six. The selection is now unique, indexed by domain, which is what the
 * bulk routes expect anyway.
 *
 * Pure logic, without React: this is what makes it possible to test the "all" rule without mounting
 * six lists.
 */

/** The identifiers retained, by domain. An absent domain means nothing selected. */
export type TrashSelection = Partial<Record<BulkDeleteDomain, number[]>>;

/** What the trash contains, by domain: the reference for "all". */
export type TrashInventory = Partial<Record<BulkDeleteDomain, number[]>>;

export const idsOf = (selection: TrashSelection, domain: BulkDeleteDomain): number[] =>
  selection[domain] ?? [];

export const isSelected = (selection: TrashSelection, domain: BulkDeleteDomain, id: number): boolean =>
  idsOf(selection, domain).includes(id);

/** Total number of retained items, across all domains. */
export const countSelected = (selection: TrashSelection): number =>
  Object.values(selection).reduce((n, ids) => n + (ids?.length ?? 0), 0);

/** Total number of items present in the trash. */
export const countAll = (inventory: TrashInventory): number => countSelected(inventory);

/** Toggles an item. */
export function toggle(selection: TrashSelection, domain: BulkDeleteDomain, id: number): TrashSelection {
  const ids = idsOf(selection, domain);
  const next = ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id];
  return { ...selection, [domain]: next };
}

/** Ticks or unticks a whole section. */
export function toggleDomain(
  selection: TrashSelection,
  domain: BulkDeleteDomain,
  all: number[],
): TrashSelection {
  const complete = all.length > 0 && idsOf(selection, domain).length === all.length;
  return { ...selection, [domain]: complete ? [] : [...all] };
}

/**
 * Ticks or unticks **all** of the trash.
 *
 * "All" means all: if a single section is incomplete, the gesture ticks the rest rather than
 * unticking what was already ticked. This is what one expects from a half-ticked "select all"
 * checkbox.
 */
export function toggleEverything(selection: TrashSelection, inventory: TrashInventory): TrashSelection {
  const everything = countSelected(selection) === countAll(inventory) && countAll(inventory) > 0;
  if (everything) return {};
  const next: TrashSelection = {};
  for (const [domain, ids] of Object.entries(inventory) as [BulkDeleteDomain, number[]][]) {
    next[domain] = [...ids];
  }
  return next;
}

/** The domains carrying at least one retained item: those to process, and those alone. */
export function selectedDomains(selection: TrashSelection): BulkDeleteDomain[] {
  return (Object.keys(selection) as BulkDeleteDomain[]).filter((d) => idsOf(selection, d).length > 0);
}
