// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { CircleDot, Trash2, UserPlus } from 'lucide-react';
import SelectionBar from '../../components/ui/selection-bar';
import BulkAssignDialog from '../../components/entity/BulkAssignDialog';
import BulkStatusDialog from '../../components/entity/BulkStatusDialog';
import { useT } from '../../i18n';

/**
 * Actions groupées d'une sélection de plans : la barre et les dialogues qu'elle ouvre.
 *
 * Extrait de `ShotsTab`, qui dépassait son budget de trois cents lignes en accueillant le
 * troisième dialogue. Le regroupement a du sens en soi : ces trois actions partagent la
 * même sélection, le même « vider la sélection » et le même rechargement.
 *
 * L'ordre suit la fréquence d'usage en production : le statut d'abord — c'est le geste qui
 * suit chaque session de review — l'assignation ensuite, la suppression en dernier et en
 * rouge.
 */
export default function ShotBulkBar({
  projectId,
  ids,
  count,
  onClear,
  onReload,
  onDelete,
}: {
  projectId: number;
  ids: number[];
  count: number;
  onClear: () => void;
  onReload: () => void;
  /** La suppression garde sa confirmation dans `ShotDialogs`, avec les autres destructions. */
  onDelete: () => void;
}) {
  const t = useT();
  const [statusOpen, setStatusOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const done = () => {
    onClear();
    onReload();
  };

  return (
    <>
      <SelectionBar
        count={count}
        label={t('shots.countLabel', { count })}
        onClear={onClear}
        actions={[
          {
            label: t('bulk.status.menu'),
            icon: <CircleDot size={14} />,
            onClick: () => setStatusOpen(true),
          },
          {
            label: t('assign.menu'),
            icon: <UserPlus size={14} />,
            onClick: () => setAssignOpen(true),
          },
          {
            label: t('common.delete'),
            icon: <Trash2 size={14} />,
            danger: true,
            onClick: onDelete,
          },
        ]}
      />

      {statusOpen && (
        <BulkStatusDialog
          projectId={projectId}
          ids={ids}
          onClose={() => setStatusOpen(false)}
          onDone={done}
        />
      )}

      {assignOpen && (
        <BulkAssignDialog
          projectId={projectId}
          holder="shots"
          ids={ids}
          onClose={() => setAssignOpen(false)}
          onDone={done}
        />
      )}
    </>
  );
}
