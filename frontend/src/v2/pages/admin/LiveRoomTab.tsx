// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Panel } from './AdminPrimitives';
import SaveBar from './SaveBar';
import SettingsFields from './SettingsFields';
import { useSaveAction, useStudioSettings } from './useStudioSettings';
import { useT } from '../../i18n';

/**
 * Salle de review live (33.B) : à quelle cadence le pilote diffuse sa position aux
 * spectateurs, par type de média.
 *
 * Ces quatre cadences occupaient un quart de la section fourre-tout, entre le quota de
 * stockage et le webhook Slack. Elles n'ont de sens qu'ensemble et ne concernent qu'un
 * seul écran du produit : elles ont maintenant le leur, dans les contextes de review.
 */
export default function LiveRoomTab() {
  const t = useT();
  const settings = useStudioSettings('live');
  const { busy, save } = useSaveAction(() => settings.commit());

  return (
    <div className="max-w-2xl">
      <Panel title={t('settings.group.live')}>
        <SettingsFields
          fields={settings.fields}
          stored={settings.stored}
          draft={settings.draft}
          units={settings.units}
          onChange={settings.setValue}
          onUnit={settings.setUnit}
        />
      </Panel>
      <SaveBar dirty={settings.dirty} busy={busy} onSave={() => void save()} onDiscard={settings.discard} />
    </div>
  );
}
