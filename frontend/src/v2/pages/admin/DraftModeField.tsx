// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Switch } from '../../components/ui/switch';
import { Panel } from './AdminPrimitives';
import { isDraftModeOn } from '../../lib/draftMode';
import { useT } from '../../i18n';

/**
 * Does the studio keep the two-step workflow?
 *
 * Since Phase 50, a media item is published as soon as it is uploaded: this is the gesture studios
 * were waiting for, and the draft becomes an option — off by default. Turning it on gives
 * the interface back the whole draft mechanism (draft badge for pending items, "My drafts"
 * filter, "Publish" action).
 *
 * The setting lives in the project defaults, next to the required instruction: the two
 * decide what happens when a media item arrives.
 */
export default function DraftModeField({
  value,
  onChange,
}: {
  /** Stored or entered value — the `Setting` table only stores text. */
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const on = isDraftModeOn(value);

  return (
    <Panel title={t('settings.draftMode')}>
      <div className="flex items-center justify-between gap-4">
        <label className="text-sm" htmlFor="draft-mode">
          {t('settings.draftMode.label')}
          <span className="block text-xs text-muted-foreground">{t('settings.draftMode.hint')}</span>
        </label>
        <Switch
          id="draft-mode"
          checked={on}
          onCheckedChange={(next) => onChange(next ? 'true' : 'false')}
          label={t('settings.draftMode.label')}
        />
      </div>
    </Panel>
  );
}
