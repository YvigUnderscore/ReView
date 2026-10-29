// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link2, Plus } from 'lucide-react';
import type { MenuEntry } from '../../lib/menuSpec';
import { useSgConnection } from '../../lib/shotgridApi';
import SequenceAddShotsDialog, { type AddShotsMode } from './SequenceAddShotsDialog';
import { useT } from '../../i18n';

/**
 * Populates a sequence: create shots, or attach existing shots to it.
 *
 * The sequence page displayed its shots without ever offering to add any: on a new sequence the
 * screen said "no shots" and stopped there — one had to go back to the project's Shots tab,
 * create them there, then pick the sequence one had just left. Both gestures now live here, and
 * the dialog state is held by a hook so that the page and the grid can both open it (right click,
 * button, empty state) without passing it down in cascade.
 *
 * On a ShotGrid-driven project, local creation is refused by the server: the create mode is then
 * disabled rather than offered for nothing, but attaching stays open — moving a shot from one
 * sequence to another is not a creation.
 */
export function useSequenceShotAdd({
  projectId,
  sequenceId,
  canManage,
  onChanged,
}: {
  projectId: number;
  sequenceId: number;
  canManage: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<AddShotsMode | null>(null);
  const { data: connection } = useSgConnection(projectId);
  const createLocked = Boolean(connection?.active && connection.settings.lockLocalCreation);

  /** The default opening mode: attach, when creating is not allowed here. */
  const open = (wanted: AddShotsMode) => setMode(createLocked ? 'attach' : wanted);

  const entries: MenuEntry[] = canManage
    ? [
        {
          id: 'sequence-shots-create',
          label: t('sequenceShots.create'),
          icon: <Plus size={14} />,
          disabled: createLocked,
          onSelect: () => open('create'),
        },
        {
          id: 'sequence-shots-attach',
          label: t('sequenceShots.attach'),
          icon: <Link2 size={14} />,
          onSelect: () => open('attach'),
        },
      ]
    : [];

  const dialog =
    mode !== null && canManage ? (
      <SequenceAddShotsDialog
        projectId={projectId}
        sequenceId={sequenceId}
        canManage={canManage}
        createLocked={createLocked}
        mode={mode}
        onModeChange={setMode}
        onClose={() => setMode(null)}
        onDone={() => {
          setMode(null);
          onChanged();
        }}
      />
    ) : null;

  return { entries, open, dialog };
}
