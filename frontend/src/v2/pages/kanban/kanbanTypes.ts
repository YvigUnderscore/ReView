// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TaskStatus, TaskType, UserRef } from '../../types/api';

/**
 * Une carte du board, telle que `GET /api/tasks/board` la renvoie (C4).
 *
 * Une tâche pend d'un shot OU d'un asset : un projet dont tout le travail vit sur des
 * assets affichait un board vide tant que seuls les shots étaient parcourus.
 * `parentLabel` porte le repère montré sur la carte, quel que soit le côté d'où elle vient.
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
  /** Code du shot ou nom de l'asset — ce que lit l'utilisateur sur la carte. */
  parentLabel: string;
  sequenceId: number | null;
}

/** Le board entier, avec le total : une troncature silencieuse se lirait comme un board complet. */
export interface BoardResponse {
  items: BoardTask[];
  total: number;
  truncated: boolean;
}
