// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

// Types des tâches (module séparé du budget de lignes d'api.ts). Refs importées d'api.ts
// (imports de type uniquement — le re-export `export * from './task'` côté api.ts n'induit
// aucun cycle à l'exécution).
import type { TaskType, TaskStatus, UserRef, ShotRef, ProjectRef, SequenceRef, AssetRef } from './api';

export interface Task {
  id: number;
  name: string;
  type: TaskType;
  /** Département du pipe (clé des réglages projet) — null tant qu'aucun n'est posé. */
  department?: string | null;
  status: TaskStatus;
  /**
   * Statut du référentiel personnalisable (Phase 48) — celui du site ShotGrid sur un
   * projet relié. `status` reste écrit en parallèle pour le kanban et les statistiques.
   */
  pipelineStatusId?: number | null;
}
/** Listes (kanban, activité projet) : assigné joint. */
export type TaskWithAssignee = Task & { assignee: UserRef | null };
/** Élément de checklist d'une tâche (38.F). */
export interface ChecklistItem {
  text: string;
  done: boolean;
}
/** GET /api/tasks/:id — contexte de localisation (shot/asset + projet). */
export type TaskDetail = Task & {
  shot?: (ShotRef & { project: ProjectRef; sequence?: SequenceRef | null }) | null;
  asset?: (AssetRef & { project: ProjectRef }) | null;
  /** Commentaire de review d'origine (32.D) — lien retour `?comment=`. */
  sourceComment?: { id: number; mediaObjectId: number } | null;
  /** Checklist (38.F) + assigné (pour les droits d'édition). */
  checklist?: ChecklistItem[];
  assignee?: UserRef | null;
  startDate?: string | null; // planification 43.C (ISO)
  dueDate?: string | null; // échéance 43.C (ISO)
};
