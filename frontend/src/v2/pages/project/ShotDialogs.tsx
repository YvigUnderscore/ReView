// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import ConfirmDialog from '../../components/ConfirmDialog';
import EntitySettingsDialog from '../../components/entity/EntitySettingsDialog';
import type { Shot } from './projectTypes';
import { useT } from '../../i18n';

/**
 * The three dialogs of the Shots tab: settings, moving one shot to the trash, and moving a
 * selection to the trash.
 *
 * Extracted for the same reason as `entityCardMenu` before them: the tab had exceeded its line
 * budget when the enriched cards were added, and these three dialogs are the most mechanical part
 * of it. No logic, only wiring.
 */
export default function ShotDialogs({
  projectId,
  editing,
  deleting,
  bulkDeleting,
  bulkCount,
  onCloseEditing,
  onCancelDelete,
  onCancelBulk,
  onConfirmDelete,
  onConfirmBulk,
  onSaved,
}: {
  projectId: number;
  editing: Shot | null;
  deleting: Shot | null;
  bulkDeleting: boolean;
  bulkCount: number;
  onCloseEditing: () => void;
  onCancelDelete: () => void;
  onCancelBulk: () => void;
  onConfirmDelete: () => void;
  onConfirmBulk: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  return (
    <>
      <ConfirmDialog
        open={bulkDeleting}
        title={t('shots.deleteMany.title')}
        message={t('shots.deleteMany.message', { count: bulkCount })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={onConfirmBulk}
        onCancel={onCancelBulk}
      />

      {editing && (
        <EntitySettingsDialog
          kind="shot"
          id={editing.id}
          projectId={projectId}
          entity={editing}
          thumbnailUrl={editing.thumbnailUrl}
          onClose={onCloseEditing}
          onSaved={onSaved}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title={t('shots.delete.title')}
        message={t('shots.delete.message', { code: deleting?.code ?? '' })}
        confirmLabel={t('common.moveToTrash')}
        danger
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />
    </>
  );
}
