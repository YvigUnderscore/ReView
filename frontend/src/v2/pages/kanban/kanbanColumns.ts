// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../../i18n';
import type { TaskStatus } from '../../types/api';
import { TASK_STATUSES, TASK_STATUS_LABEL_KEY } from '../../lib/taskStatus';

/**
 * Colonnes du kanban, bâties sur le référentiel du projet (C4).
 *
 * Le board affichait les six valeurs figées de l'énumération. Un site ShotGrid en définit
 * couramment quinze : déposer une carte dans « Approved » écrivait le premier statut du
 * référentiel qui porte cet enum, et le studio retrouvait « Waiting to Start » là où il
 * avait mis « On Hold ». Les colonnes viennent donc du vocabulaire réel du projet.
 *
 * Quinze colonnes côte à côte ne se lisent pas. Elles sont regroupées en cinq familles
 * dépliables, dérivées de `legacyStatus` — la seule information que porte déjà chaque
 * statut, quel que soit son nom sur le site.
 */

export type FamilyKey = 'todo' | 'progress' | 'review' | 'done' | 'blocked';

export const FAMILY_ORDER: readonly FamilyKey[] = ['todo', 'progress', 'review', 'done', 'blocked'];

export const FAMILY_LABEL_KEY: Record<FamilyKey, MessageKey> = {
  todo: 'kanban.family.todo',
  progress: 'kanban.family.progress',
  review: 'kanban.family.review',
  done: 'kanban.family.done',
  blocked: 'kanban.family.blocked',
};

/** À quelle famille appartient une valeur de l'énumération. */
const FAMILY_OF: Record<TaskStatus, FamilyKey> = {
  TODO: 'todo',
  IN_PROGRESS: 'progress',
  PENDING_REVIEW: 'review',
  APPROVED: 'done',
  RETAKE: 'blocked',
  REJECTED: 'blocked',
};

export function familyOf(legacy: TaskStatus | null | undefined): FamilyKey {
  return legacy ? FAMILY_OF[legacy] : 'todo';
}

/** Un statut du référentiel, tel que le board le manipule. */
export interface ColumnStatus {
  id: number;
  name: string;
  code: string;
  color: string | null;
  legacyStatus: TaskStatus | null;
}

export interface Column {
  /** Identifiant de zone de dépôt : celui du référentiel, ou la valeur de l'énumération. */
  id: string;
  label: string;
  /** Présent quand la colonne vient du référentiel du projet. */
  statusId: number | null;
  legacyStatus: TaskStatus;
  color: string | null;
  family: FamilyKey;
}

export interface FamilyGroup {
  key: FamilyKey;
  columns: Column[];
}

/**
 * Les colonnes du projet, ordonnées par famille puis par ordre du référentiel.
 * Sans référentiel (studio autonome qui n'a jamais rien personnalisé), on retombe sur
 * les six valeurs figées — c'est exactement ce que le studio voit ailleurs.
 */
export function buildColumns(statuses: ColumnStatus[], t: (key: MessageKey) => string): Column[] {
  if (statuses.length === 0) {
    return TASK_STATUSES.map((legacy) => ({
      id: legacy,
      label: t(TASK_STATUS_LABEL_KEY[legacy]),
      statusId: null,
      legacyStatus: legacy,
      color: null,
      family: familyOf(legacy),
    }));
  }
  const columns = statuses.map((s) => ({
    id: String(s.id),
    label: s.name,
    statusId: s.id,
    legacyStatus: s.legacyStatus ?? 'TODO',
    color: s.color,
    family: familyOf(s.legacyStatus),
  }));
  // Tri stable par famille : l'ordre du référentiel est conservé à l'intérieur.
  return columns
    .map((c, index) => ({ c, index }))
    .sort((a, b) => FAMILY_ORDER.indexOf(a.c.family) - FAMILY_ORDER.indexOf(b.c.family) || a.index - b.index)
    .map(({ c }) => c);
}

/** Regroupe les colonnes visibles par famille ; une famille sans colonne disparaît. */
export function groupByFamily(columns: Column[], hidden: ReadonlySet<string>): FamilyGroup[] {
  const groups: FamilyGroup[] = [];
  for (const family of FAMILY_ORDER) {
    const cols = columns.filter((c) => c.family === family && !hidden.has(c.id));
    if (cols.length > 0) groups.push({ key: family, columns: cols });
  }
  return groups;
}

/** La colonne d'une tâche : son statut du référentiel, sinon son énumération. */
export function columnIdOf(
  task: { pipelineStatusId: number | null; status: TaskStatus },
  columns: Column[],
): string | null {
  if (task.pipelineStatusId != null) {
    const byId = columns.find((c) => c.statusId === task.pipelineStatusId);
    if (byId) return byId.id;
  }
  // Le statut de la tâche n'est pas offert au projet (statut d'un autre site, ou colonne
  // masquée) : on la range dans la première colonne de même valeur d'énumération plutôt
  // que de la faire disparaître du board.
  return columns.find((c) => c.legacyStatus === task.status)?.id ?? null;
}
