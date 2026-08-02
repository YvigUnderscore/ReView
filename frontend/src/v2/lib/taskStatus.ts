// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TaskStatus } from '../types/api';
import type { MessageKey } from '../i18n';

/**
 * Statuts de tâche — source unique des clés de libellé et des couleurs.
 * Ne jamais redéclarer ces mappings dans une page : importer d'ici.
 */
export const TASK_STATUSES = [
  'TODO',
  'IN_PROGRESS',
  'PENDING_REVIEW',
  'RETAKE',
  'REJECTED',
  'APPROVED',
] as const satisfies readonly TaskStatus[];

export const TASK_STATUS_LABEL_KEY: Record<string, MessageKey> = {
  TODO: 'task.status.todo',
  IN_PROGRESS: 'task.status.inProgress',
  PENDING_REVIEW: 'task.status.toReview',
  RETAKE: 'task.status.retake',
  REJECTED: 'task.status.rejected',
  APPROVED: 'task.status.approved',
};

export const TASK_STATUS_COLOR: Record<string, string> = {
  TODO: 'bg-muted text-muted-foreground',
  IN_PROGRESS: 'bg-info/15 text-info',
  PENDING_REVIEW: 'bg-warning/15 text-warning',
  APPROVED: 'bg-success/15 text-success',
  REJECTED: 'bg-destructive/15 text-destructive',
  RETAKE: 'bg-accent2/15 text-accent2',
};

// Couleurs pleines pour les jauges/barres de progression (mêmes teintes que les badges).
export const TASK_STATUS_BAR: Record<string, string> = {
  TODO: 'bg-muted-foreground/40',
  IN_PROGRESS: 'bg-info',
  PENDING_REVIEW: 'bg-warning',
  APPROVED: 'bg-success',
  REJECTED: 'bg-destructive',
  RETAKE: 'bg-accent2',
};

// Priorité décroissante : ce qui demande une action remonte en haut des listes.
export const TASK_STATUS_PRIORITY: Record<string, number> = {
  RETAKE: 0,
  REJECTED: 1,
  PENDING_REVIEW: 2,
  IN_PROGRESS: 3,
  TODO: 4,
  APPROVED: 5,
};
