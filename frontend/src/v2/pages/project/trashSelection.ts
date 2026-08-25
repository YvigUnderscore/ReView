// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BulkDeleteDomain } from '../../lib/bulkApi';

/**
 * Sélection de la corbeille, **toutes sections confondues**.
 *
 * Chaque section avait la sienne : cocher « tout » dans les plans ne touchait ni les
 * séquences, ni les assets, ni les versions. Vider une corbeille de fin de projet demandait
 * donc six passes, et il fallait penser aux six. La sélection est désormais unique, indexée
 * par domaine — ce que les routes de masse attendent de toute façon.
 *
 * Logique pure, sans React : c'est ce qui permet de tester la règle du « tout » sans monter
 * six listes.
 */

/** Les identifiants retenus, par domaine. Un domaine absent vaut « rien de sélectionné ». */
export type TrashSelection = Partial<Record<BulkDeleteDomain, number[]>>;

/** Ce que la corbeille contient, par domaine — la référence du « tout ». */
export type TrashInventory = Partial<Record<BulkDeleteDomain, number[]>>;

export const idsOf = (selection: TrashSelection, domain: BulkDeleteDomain): number[] =>
  selection[domain] ?? [];

export const isSelected = (selection: TrashSelection, domain: BulkDeleteDomain, id: number): boolean =>
  idsOf(selection, domain).includes(id);

/** Nombre total d'éléments retenus, tous domaines confondus. */
export const countSelected = (selection: TrashSelection): number =>
  Object.values(selection).reduce((n, ids) => n + (ids?.length ?? 0), 0);

/** Nombre total d'éléments présents dans la corbeille. */
export const countAll = (inventory: TrashInventory): number => countSelected(inventory);

/** Bascule un élément. */
export function toggle(selection: TrashSelection, domain: BulkDeleteDomain, id: number): TrashSelection {
  const ids = idsOf(selection, domain);
  const next = ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id];
  return { ...selection, [domain]: next };
}

/** Coche ou décoche une section entière. */
export function toggleDomain(
  selection: TrashSelection,
  domain: BulkDeleteDomain,
  all: number[],
): TrashSelection {
  const complete = all.length > 0 && idsOf(selection, domain).length === all.length;
  return { ...selection, [domain]: complete ? [] : [...all] };
}

/**
 * Coche ou décoche **toute** la corbeille.
 *
 * « Tout » veut dire tout : si une seule section est incomplète, le geste coche le reste
 * plutôt que de décocher ce qui l'était déjà — c'est ce qu'on attend d'une case « tout
 * sélectionner » à moitié cochée.
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

/** Les domaines qui portent au moins un élément retenu — ceux à traiter, et eux seuls. */
export function selectedDomains(selection: TrashSelection): BulkDeleteDomain[] {
  return (Object.keys(selection) as BulkDeleteDomain[]).filter((d) => idsOf(selection, d).length > 0);
}
