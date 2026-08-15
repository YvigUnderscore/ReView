// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fenêtre de travail d'une tâche, telle qu'elle se lit sur une fiche.
 *
 * La règle d'affichage est séparée du rendu parce qu'elle porte une décision : une
 * échéance dépassée l'emporte sur la fenêtre complète. Sur une fiche, ce qu'on cherche
 * n'est pas « du 10 au 20 » mais « c'était pour hier ».
 */

export interface TaskDates {
  startDate?: string | null;
  dueDate?: string | null;
}

/** Une échéance est dépassée dès que le jour dit est passé. */
export function isLate(due: string | null | undefined, now: number = Date.now()): boolean {
  if (!due) return false;
  const time = new Date(due).getTime();
  return Number.isFinite(time) && time < now;
}

export type ScheduleLabel =
  | { key: 'task.schedule.late'; date: string }
  | { key: 'task.schedule.window'; start: string; due: string }
  | { key: 'task.schedule.due'; date: string }
  | null;

/**
 * Ce qu'il faut afficher, sous forme de clé et de dates brutes : le formatage suit la
 * locale du lecteur et n'a rien à faire ici.
 */
export function scheduleLabel(task: TaskDates, now: number = Date.now()): ScheduleLabel {
  if (!task.startDate && !task.dueDate) return null;
  if (task.dueDate && isLate(task.dueDate, now)) return { key: 'task.schedule.late', date: task.dueDate };
  if (task.startDate) return { key: 'task.schedule.window', start: task.startDate, due: task.dueDate ?? '' };
  return { key: 'task.schedule.due', date: task.dueDate as string };
}
