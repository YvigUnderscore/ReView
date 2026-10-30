// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { toast } from 'sonner';
import {
  NOTIFICATION_KINDS,
  channelEnabled,
  withChannel,
  type NotificationChannel,
  type NotificationKind,
  type NotificationSettings as Settings,
} from '../../lib/notificationKinds';
import { usePreferences, useUpdatePreferences } from '../../lib/usePreferences';
import { useT, type Tr } from '../../i18n';
import { Hint } from '../../components/ui/hint';

/**
 * Notification settings per event type (batch 9).
 *
 * None existed: the profile only offered the email digest, the weekly report and the browser push
 * subscription, that is, everything except what actually arrives, line by line, in the panel. The
 * `notificationKinds` registry is the only source of the displayed list here. It is also what
 * `notify()` consults on the server side, so a box ticked here necessarily matches a decision
 * taken there.
 *
 * No setting means enabled. The grid therefore starts fully ticked for a new account, and a kind
 * added later arrives enabled, without a migration.
 */

/**
 * Label of a kind. A `switch` on literal keys, not a table of constants: a table would freeze the
 * language at module load (i18n rule 5), and a constructed key would escape the dead-key detector.
 */
function kindLabel(t: Tr, kind: NotificationKind): string {
  switch (kind) {
    case 'mention':
      return t('notifKind.mention');
    case 'reply':
      return t('notifKind.reply');
    case 'commentAssigned':
      return t('notifKind.commentAssigned');
    case 'taskAssigned':
      return t('notifKind.taskAssigned');
    case 'reviewAssigned':
      return t('notifKind.reviewAssigned');
    case 'reviewDecision':
      return t('notifKind.reviewDecision');
    case 'watch':
      return t('notifKind.watch');
    case 'live':
      return t('notifKind.live');
  }
}

export default function NotificationSettings() {
  const t = useT();
  const prefsQ = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const settings = prefsQ.data?.notifications as Settings | undefined;
  // The mutation in progress disables the whole grid: the server merge replaces `notifications` as
  // a block, so two concurrent toggles would overwrite each other.
  const busy = prefsQ.isLoading || updatePrefs.isPending;

  const toggle = (kind: NotificationKind, channel: NotificationChannel, enabled: boolean) => {
    updatePrefs.mutate(
      { notifications: withChannel(settings, kind, channel, enabled) },
      { onError: (e) => toast.error(e instanceof Error ? e.message : t('common.error.generic')) },
    );
  };

  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm">{t('notifSettings.title')}</div>
        <Hint>{t('notifSettings.hint')}</Hint>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="py-1 text-left font-normal">
              {t('notifSettings.event')}
            </th>
            <th scope="col" className="w-20 py-1 text-center font-normal">
              {t('notifSettings.inApp')}
            </th>
            <th scope="col" className="w-20 py-1 text-center font-normal">
              {t('notifSettings.push')}
            </th>
          </tr>
        </thead>
        <tbody>
          {NOTIFICATION_KINDS.map((kind) => (
            <tr key={kind} className="border-t border-border">
              <td className="py-1.5 pr-2">{kindLabel(t, kind)}</td>
              {(['inApp', 'push'] as const).map((channel) => (
                <td key={channel} className="py-1.5 text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    disabled={busy}
                    checked={channelEnabled(settings, kind, channel)}
                    onChange={(e) => toggle(kind, channel, e.target.checked)}
                    aria-label={`${kindLabel(t, kind)} — ${
                      channel === 'inApp' ? t('notifSettings.inApp') : t('notifSettings.push')
                    }`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
