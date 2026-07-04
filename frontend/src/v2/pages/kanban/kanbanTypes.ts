import type { TaskWithAssignee } from '../../types/api';

/** Tâche enrichie du contexte de son shot pour l'affichage kanban. */
export type BoardTask = TaskWithAssignee & {
  shotId: number;
  shotCode: string;
  sequenceId: number | null;
};

/** Initiales à partir d'un nom (repli pour l'avatar de l'assigné). */
export function initialsFrom(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (first + last).toUpperCase() || '?';
}
