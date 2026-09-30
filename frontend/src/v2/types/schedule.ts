// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

// Planning projet (43.C — GET /api/projects/:id/schedule). Miroir de backend ScheduleService.
import type { TaskStatus, TaskType } from './api';

export interface ScheduleTask {
  id: number;
  name: string;
  type: TaskType;
  status: TaskStatus;
  startDate: string | null;
  dueDate: string | null;
  location: string;
  sequenceId: number | null;
  sequenceCode: string | null;
  assignee: { id: number; name: string | null } | null;
}

export interface ProjectSchedule {
  tasks: ScheduleTask[];
}
