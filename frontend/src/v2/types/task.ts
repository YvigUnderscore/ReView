// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

// Task types (separate module from the line budget of api.ts). Refs imported from api.ts
// (type-only imports — the `export * from './task'` re-export on the api.ts side creates no
// runtime cycle).
import type { TaskType, TaskStatus, UserRef, ShotRef, ProjectRef, SequenceRef, AssetRef } from './api';

export interface Task {
  id: number;
  name: string;
  type: TaskType;
  /** Pipeline department (key of the project settings) — null until one is set. */
  department?: string | null;
  status: TaskStatus;
  /**
   * Status from the customisable reference list (Phase 48) — the one from the ShotGrid site on a
   * linked project. `status` is still written in parallel for the kanban and the statistics.
   */
  pipelineStatusId?: number | null;
  /** Brief: what there is to do (Phase 50). `null` = no brief written. */
  description?: string | null;
}
/** Lists (kanban, project activity): assignee included. */
export type TaskWithAssignee = Task & { assignee: UserRef | null };
/** Checklist item of a task (38.F). */
export interface ChecklistItem {
  text: string;
  done: boolean;
}
/** GET /api/tasks/:id — location context (shot/asset + project). */
export type TaskDetail = Task & {
  shot?: (ShotRef & { project: ProjectRef; sequence?: SequenceRef | null }) | null;
  asset?: (AssetRef & { project: ProjectRef }) | null;
  /** Originating review comment (32.D) — return link `?comment=`. */
  sourceComment?: { id: number; mediaObjectId: number } | null;
  /** Checklist (38.F) + assignee (for edit rights). */
  checklist?: ChecklistItem[];
  assignee?: UserRef | null;
  startDate?: string | null; // scheduling 43.C (ISO)
  dueDate?: string | null; // due date 43.C (ISO)
};
