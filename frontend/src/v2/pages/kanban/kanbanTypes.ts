// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TaskWithAssignee } from '../../types/api';

/**
 * Tâche enrichie de son contexte pour l'affichage kanban.
 *
 * Une tâche pend d'un shot OU d'un asset : un projet dont tout le travail vit sur des
 * assets (modélisation, texturing) affichait un board vide tant que seuls les shots
 * étaient parcourus. `parentLabel` porte le repère montré sur la carte, quel que soit
 * le côté d'où vient la tâche.
 */
export type BoardTask = TaskWithAssignee & {
  shotId: number | null;
  assetId: number | null;
  /** Code du shot ou nom de l'asset — ce que lit l'utilisateur sur la carte. */
  parentLabel: string;
  parentKind: 'shot' | 'asset';
  sequenceId: number | null;
};

/** Filtres du board (valeurs de selects ; '' = tous, 'none' = sans). */
export interface KanbanFilterState {
  assignee: string;
  type: string;
  sequence: string;
}

/** Vue kanban sauvegardée (préférences utilisateur, par projet). */
export interface KanbanSavedView {
  name: string;
  filter: KanbanFilterState;
}
/** `preferences.kanbanViews` : clé = projectId (string, JSON). */
export type KanbanViewsPref = Record<string, KanbanSavedView[]>;

/** Ajoute ou remplace (même nom) une vue du projet — pur, sans mutation. */
export function upsertView(
  views: KanbanViewsPref,
  projectId: number,
  view: KanbanSavedView,
): KanbanViewsPref {
  const key = String(projectId);
  const rest = (views[key] ?? []).filter((v) => v.name !== view.name);
  return { ...views, [key]: [...rest, view] };
}

/** Retire une vue du projet (clé supprimée si plus aucune vue) — pur. */
export function removeView(views: KanbanViewsPref, projectId: number, name: string): KanbanViewsPref {
  const key = String(projectId);
  const remaining = (views[key] ?? []).filter((v) => v.name !== name);
  const next = { ...views };
  if (remaining.length === 0) delete next[key];
  else next[key] = remaining;
  return next;
}

// Initiales : helper partagé (relocalisé en `lib/initials`), ré-exporté pour compat.
export { initialsFrom } from '../../lib/initials';
