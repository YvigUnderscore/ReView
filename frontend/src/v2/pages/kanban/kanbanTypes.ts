// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TaskStatus, TaskType, UserRef } from '../../types/api';

/**
 * A card of the board, as `GET /api/tasks/board` returns it (C4).
 *
 * A task hangs from a shot OR an asset: a project whose work lives on assets displayed an empty
 * board for as long as only the shots were scanned.
 * `parentLabel` carries the marker shown on the card, whichever side it comes from.
 */
export interface BoardTask {
  id: number;
  name: string;
  type: TaskType;
  status: TaskStatus;
  pipelineStatusId: number | null;
  department: string | null;
  departmentId: number | null;
  assignee: UserRef | null;
  dueDate: string | null;
  versionCount: number;
  parentKind: 'shot' | 'asset';
  parentId: number;
  /** Shot code or asset name: what the user reads on the card. */
  parentLabel: string;
  sequenceId: number | null;
}

/** The whole board, with its total: a silent truncation would read as a complete board. */
export interface BoardResponse {
  items: BoardTask[];
  total: number;
  truncated: boolean;
}
