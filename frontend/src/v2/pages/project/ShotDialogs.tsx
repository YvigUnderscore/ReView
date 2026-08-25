// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import ConfirmDialog from '../../components/ConfirmDialog';
import EntitySettingsDialog from '../../components/entity/EntitySettingsDialog';
import type { Shot } from './projectTypes';
import { useT } from '../../i18n';

/**
 * Les trois boîtes de dialogue de l'onglet Plans : réglages, mise à la corbeille d'un plan,
 * mise à la corbeille d'une sélection.
 *
 * Extraites pour la même raison que `shotCardActions` avant elles — l'onglet a dépassé son
 * budget de lignes en accueillant les cartes enrichies, et ces trois dialogues sont ce
 * qu'il contenait de plus mécanique : aucune logique, seulement du branchement.
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
