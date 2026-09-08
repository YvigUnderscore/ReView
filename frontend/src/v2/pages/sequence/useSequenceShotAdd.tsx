// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link2, Plus } from 'lucide-react';
import type { MenuEntry } from '../../lib/menuSpec';
import { useSgConnection } from '../../lib/shotgridApi';
import SequenceAddShotsDialog, { type AddShotsMode } from './SequenceAddShotsDialog';
import { useT } from '../../i18n';

/**
 * Peupler une séquence : créer des plans, ou y rattacher des plans existants.
 *
 * La page de séquence montrait ses plans sans jamais offrir d'en ajouter : sur une
 * séquence neuve, l'écran disait « aucun plan » et s'arrêtait là — il fallait repartir
 * vers l'onglet Plans du projet, y créer, puis choisir la séquence qu'on venait de
 * quitter. Les deux gestes vivent désormais ici, et l'état de la boîte de dialogue est
 * tenu par un hook pour que la page comme la grille puissent l'ouvrir (clic droit,
 * bouton, état vide) sans se le repasser en cascade.
 *
 * Sur un projet piloté par ShotGrid, la création locale est refusée par le serveur : le
 * mode est alors désactivé plutôt que proposé pour rien, mais le rattachement reste
 * ouvert — déplacer un plan d'une séquence à l'autre n'est pas une création.
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

  /** Le mode d'ouverture par défaut : rattacher, quand créer n'est pas permis ici. */
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
