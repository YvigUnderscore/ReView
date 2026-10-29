// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Input } from '../../components/ui/input';
import { SkeletonRows } from '../../components/ui/skeleton';
import { QueryState } from '../../components/ui/query-state';
import { Panel } from './AdminPrimitives';
import SaveBar from './SaveBar';
import SettingsFields from './SettingsFields';
import { useSaveAction, useStudioRow, useStudioSettings } from './useStudioSettings';
import { useT } from '../../i18n';

/**
 * Team messaging: where ReView announces decisions and publications.
 *
 * The Slack webhook lived in the catch-all section; the Discord one had **no
 * screen** — the API exposed it, the service used it, and it could only be set in the database. Two
 * halves of the same gesture, separated by an interface gap. They now sit here under a
 * single bar.
 */
export default function ChatTab() {
  const t = useT();
  const qc = useQueryClient();
  const settings = useStudioSettings('chat');
  const studioQ = useStudioRow();

  // The Discord webhook is carried by the Studio row, not by the key/value table: its
  // draft is separate, its save bar is the same.
  const [discord, setDiscord] = useState<string | null>(null);
  const storedDiscord = studioQ.data?.discordWebhookUrl ?? '';
  const discordDirty = discord !== null && discord !== storedDiscord;

  const { busy, save } = useSaveAction(async () => {
    if (discordDirty) {
      // Field emptied = integration switched off: the server expects `null`, not the empty string,
      // which it would refuse as an invalid URL.
      await api.patch('/api/studio', { discordWebhookUrl: discord.trim() || null });
      await qc.invalidateQueries({ queryKey: qk.admin('studio') });
      setDiscord(null);
    }
    await settings.commit();
  });

  const discard = () => {
    setDiscord(null);
    settings.discard();
  };

  if (!settings.query.data) {
    return <QueryState query={settings.query} skeleton={<SkeletonRows count={2} />} />;
  }

  return (
    <div className="max-w-2xl">
      <Panel title={t('settings.group.integrations')}>
        <div className="space-y-2">
          <SettingsFields
            fields={settings.fields}
            stored={settings.stored}
            draft={settings.draft}
            units={settings.units}
            onChange={settings.setValue}
            onUnit={settings.setUnit}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="w-64 text-muted-foreground" htmlFor="studio-discord-webhook">
              {t('settings.discordWebhook')}
            </label>
            <Input
              id="studio-discord-webhook"
              className="flex-1 py-1 text-xs"
              placeholder={t('settings.hint.discord')}
              value={discord ?? storedDiscord}
              onChange={(e) => setDiscord(e.target.value)}
            />
          </div>
        </div>
      </Panel>

      <SaveBar
        dirty={settings.dirty || discordDirty}
        busy={busy}
        onSave={() => void save()}
        onDiscard={discard}
      />
    </div>
  );
}
