// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TaskStatus } from './api';

/**
 * Pilotage de production (C6) — miroir de `ProductionService`.
 *
 * Quatre réponses : où en est le projet, ce qui bloque, qui fait quoi, à quel rythme.
 */

export type Family = 'todo' | 'progress' | 'review' | 'done' | 'blocked';

export interface MatrixCell extends Record<Family, number> {
  sequenceId: number | null;
  department: string | null;
  total: number;
}

export interface ProductionTask {
  id: number;
  name: string;
  status: TaskStatus;
  dueDate: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  department: string | null;
  sequenceId: number | null;
  sequenceCode: string | null;
  parentLabel: string;
}

export interface WorkloadRow {
  assigneeId: number | null;
  name: string | null;
  todo: number;
  progress: number;
  review: number;
  blocked: number;
  overdue: number;
  total: number;
}

export interface WeekPoint {
  weekStart: string;
  delivered: number;
}

export interface Projection {
  done: number;
  total: number;
  perWeek: number;
  projectedEnd: string | null;
}

export interface ProductionOverview {
  matrix: MatrixCell[];
  sequences: { id: number; code: string }[];
  departments: string[];
  attention: {
    overdue: ProductionTask[];
    unassigned: ProductionTask[];
    waitingReview: ProductionTask[];
  };
  workload: WorkloadRow[];
  pace: WeekPoint[];
  projection: Projection;
}
