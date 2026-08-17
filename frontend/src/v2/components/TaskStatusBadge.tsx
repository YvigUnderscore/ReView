// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useT } from '../i18n';
import { TASK_STATUS_COLOR, TASK_STATUS_LABEL_KEY } from '../lib/taskStatus';
import type { TaskStatus } from '../types/api';
import PipelineStatusBadge from './shotgrid/PipelineStatusBadge';

/**
 * Statut d'une tâche.
 *
 * Deux référentiels coexistent : celui, personnalisable, qui reçoit les statuts du site
 * ShotGrid, et l'énumération d'origine que le kanban et les statistiques utilisent
 * toujours. Le premier prime à l'affichage quand il est renseigné — c'est le vocabulaire
 * du studio ; le second reste le repli, jamais un vide.
 */
export default function TaskStatusBadge({
  status,
  pipelineStatusId,
}: {
  status: TaskStatus;
  pipelineStatusId?: number | null;
}) {
  const t = useT();
  if (pipelineStatusId) return <PipelineStatusBadge statusId={pipelineStatusId} scope="task" />;
  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${TASK_STATUS_COLOR[status] ?? ''}`}>
      {TASK_STATUS_LABEL_KEY[status] ? t(TASK_STATUS_LABEL_KEY[status]) : status}
    </span>
  );
}
