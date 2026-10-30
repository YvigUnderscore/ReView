// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Panel } from './AdminPrimitives';
import SaveBar from './SaveBar';
import SettingsFields from './SettingsFields';
import { useSaveAction, useStudioSettings } from './useStudioSettings';
import { useT } from '../../i18n';

/**
 * Live review room (33.B): how often the driver broadcasts their position to
 * viewers, per media type.
 *
 * These four cadences took a quarter of the catch-all section, between the storage
 * quota and the Slack webhook. They only make sense together and concern only one
 * screen of the product: they now have their own, in the review contexts.
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
