// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Filtres partagés des listes de projet (C4) : kanban, Shots, Assets.
 *
 * Les deux dernières n'avaient ni filtre ni recherche : sur un long-métrage — deux mille
 * plans, mille assets — il n'existait aucun moyen de retrouver quoi que ce soit autrement
 * qu'en faisant défiler. Le kanban, lui, avait ses trois filtres à lui, incompatibles avec
 * les vues sauvegardées du reste de l'application.
 *
 * Un filtre vide vaut « tout » ; la valeur `none` vaut « sans » (sans assigné, hors
 * séquence, sans département) — c'est une réponse à part entière, pas une absence.
 */

export const NONE = 'none';

/** Jeu de filtres, sérialisable tel quel dans une vue sauvegardée. */
export interface EntityFilterState {
  /** Recherche libre sur le nom, le code et le parent. */
  text: string;
  status: string;
  assignee: string;
  sequence: string;
  department: string;
  type: string;
}

export const EMPTY_FILTERS: EntityFilterState = {
  text: '',
  status: '',
  assignee: '',
  sequence: '',
  department: '',
  type: '',
};

/** Un filtre est-il actif ? Sert au décompte affiché et à l'activation d'« effacer ». */
export function activeCount(filters: EntityFilterState): number {
  return Object.values(filters).filter((v) => v !== '').length;
}

/** Vers la forme des vues sauvegardées (clé → valeur, les vides omis). */
export function toRecord(filters: EntityFilterState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) if (v !== '') out[k] = v;
  return out;
}

/** Depuis une vue sauvegardée : les clés inconnues sont ignorées, les absentes vidées. */
export function fromRecord(record: Record<string, string>): EntityFilterState {
  const out = { ...EMPTY_FILTERS };
  for (const key of Object.keys(EMPTY_FILTERS) as (keyof EntityFilterState)[]) {
    const value = record[key];
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/** Ce qu'une entité offre au filtrage. Les champs absents ne sont jamais éliminatoires. */
export interface Filterable {
  text: string;
  statusId?: number | null;
  legacyStatus?: string | null;
  assigneeId?: number | null;
  sequenceId?: number | null;
  departmentId?: number | null;
  department?: string | null;
  type?: string | null;
}

/** Un critère « identifiant » : vide = tout, `none` = sans, sinon égalité sur la valeur. */
function matchId(filter: string, value: number | null | undefined): boolean {
  if (filter === '') return true;
  if (filter === NONE) return value == null;
  return String(value ?? '') === filter;
}

export function matches(filters: EntityFilterState, item: Filterable): boolean {
  if (filters.text !== '' && !item.text.toLowerCase().includes(filters.text.trim().toLowerCase())) {
    return false;
  }
  if (!matchId(filters.assignee, item.assigneeId)) return false;
  if (!matchId(filters.sequence, item.sequenceId)) return false;
  if (!matchId(filters.department, item.departmentId)) return false;
  if (filters.type !== '' && (item.type ?? '') !== filters.type) return false;
  if (filters.status !== '') {
    // Le statut se compare d'abord au référentiel du projet ; l'énumération ne sert que
    // pour les entités anciennes, qui n'ont jamais reçu de statut personnalisé.
    if (filters.status === NONE) return item.statusId == null;
    const byId = item.statusId != null && String(item.statusId) === filters.status;
    const byLegacy = item.statusId == null && item.legacyStatus === filters.status;
    if (!byId && !byLegacy) return false;
  }
  return true;
}

export function applyFilters<T>(
  filters: EntityFilterState,
  items: T[],
  toFilterable: (item: T) => Filterable,
): T[] {
  if (activeCount(filters) === 0) return items;
  return items.filter((item) => matches(filters, toFilterable(item)));
}
