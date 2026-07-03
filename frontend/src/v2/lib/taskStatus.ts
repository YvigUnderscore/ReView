import type { TaskStatus } from '../types/api';

/**
 * Statuts de tâche — source unique des libellés FR et couleurs.
 * Ne jamais redéclarer ces mappings dans une page : importer d'ici.
 */
export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'PENDING_REVIEW', 'RETAKE', 'REJECTED', 'APPROVED'] as const satisfies readonly TaskStatus[];

export const TASK_STATUS_LABEL: Record<string, string> = {
  TODO: 'À faire',
  IN_PROGRESS: 'En cours',
  PENDING_REVIEW: 'À review',
  RETAKE: 'Retake',
  REJECTED: 'Rejeté',
  APPROVED: 'Approuvé',
};

export const TASK_STATUS_COLOR: Record<string, string> = {
  TODO: 'bg-muted text-muted-foreground',
  IN_PROGRESS: 'bg-blue-500/20 text-blue-300',
  PENDING_REVIEW: 'bg-amber-500/20 text-amber-300',
  APPROVED: 'bg-green-500/20 text-green-300',
  REJECTED: 'bg-red-500/20 text-red-300',
  RETAKE: 'bg-orange-500/20 text-orange-300',
};

// Couleurs pleines pour les jauges/barres de progression (mêmes teintes que les badges).
export const TASK_STATUS_BAR: Record<string, string> = {
  TODO: 'bg-muted-foreground/40',
  IN_PROGRESS: 'bg-blue-400',
  PENDING_REVIEW: 'bg-amber-400',
  APPROVED: 'bg-green-400',
  REJECTED: 'bg-red-400',
  RETAKE: 'bg-orange-400',
};

// Priorité décroissante : ce qui demande une action remonte en haut des listes.
export const TASK_STATUS_PRIORITY: Record<string, number> = {
  RETAKE: 0, REJECTED: 1, PENDING_REVIEW: 2, IN_PROGRESS: 3, TODO: 4, APPROVED: 5,
};
