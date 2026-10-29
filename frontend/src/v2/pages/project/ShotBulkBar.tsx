// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { CircleDot, Trash2, UserPlus } from 'lucide-react';
import SelectionBar from '../../components/ui/selection-bar';
import BulkAssignDialog from '../../components/entity/BulkAssignDialog';
import BulkStatusDialog from '../../components/entity/BulkStatusDialog';
import { useT } from '../../i18n';

/**
 * Bulk actions for a selection of shots: the bar and the dialogs it opens.
 *
 * Extracted from `ShotsTab`, which exceeded its three-hundred-line budget when the third dialog
 * arrived. The grouping makes sense in itself: these three actions share the same selection, the
 * same "clear selection" and the same reload.
 *
 * The order follows frequency of use in production: status first, since it is the gesture that
 * follows every review session; assignment next; deletion last, and in red.
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
  /** Deletion keeps its confirmation in `ShotDialogs`, with the other destructive actions. */
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
            // The gesture moves to the trash (`softDelete`): say so, as on the card.
            label: t('common.moveToTrash'),
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
