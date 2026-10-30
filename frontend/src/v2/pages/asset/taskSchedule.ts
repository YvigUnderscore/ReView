// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Working window of a task, as read on a card.
 *
 * The display rule is separated from rendering because it carries a decision: an
 * overdue due date outweighs the full window. On a card, what one looks for
 * is not "from the 10th to the 20th" but "it was due yesterday".
 */

export interface TaskDates {
  startDate?: string | null;
  dueDate?: string | null;
}

/** A due date is overdue as soon as its day has passed. */
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
 * What to display, as a key and raw dates: formatting follows the
 * reader's locale and has no business here.
 */
export function scheduleLabel(task: TaskDates, now: number = Date.now()): ScheduleLabel {
  if (!task.startDate && !task.dueDate) return null;
  if (task.dueDate && isLate(task.dueDate, now)) return { key: 'task.schedule.late', date: task.dueDate };
  if (task.startDate) return { key: 'task.schedule.window', start: task.startDate, due: task.dueDate ?? '' };
  return { key: 'task.schedule.due', date: task.dueDate as string };
}
