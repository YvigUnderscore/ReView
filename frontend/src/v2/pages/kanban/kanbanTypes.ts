import type { TaskWithAssignee } from '../../types/api';

/** Tâche enrichie du contexte de son shot pour l'affichage kanban. */
export type BoardTask = TaskWithAssignee & {
  shotId: number;
  shotCode: string;
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

/** Initiales à partir d'un nom (repli pour l'avatar de l'assigné). */
export function initialsFrom(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (first + last).toUpperCase() || '?';
}
