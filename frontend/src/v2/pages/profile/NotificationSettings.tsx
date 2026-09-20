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

/**
 * Réglages de notification par type d'événement (lot 9).
 *
 * Il n'en existait aucun : le profil n'offrait que le digest email, le rapport hebdo et
 * l'abonnement push du navigateur — c'est-à-dire tout sauf ce qui arrive vraiment, ligne
 * après ligne, dans le panneau. Le registre `notificationKinds` est ici la seule source de
 * la liste affichée : il est aussi celui que `notify()` consulte côté serveur, si bien
 * qu'une case cochée ici correspond nécessairement à une décision prise là-bas.
 *
 * Absence de réglage = activé. La grille part donc tout cochée pour un compte neuf, et un
 * genre ajouté plus tard arrive activé sans migration.
 */

/**
 * Libellé d'un genre. Un `switch` à clés littérales, et non une table de constantes : une
 * table figerait la langue au chargement du module (règle i18n 5), et une clé construite
 * échapperait au détecteur de clés mortes.
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
  // La mutation en cours désactive la grille entière : la fusion du serveur remplace
  // `notifications` d'un bloc, deux bascules concurrentes s'écraseraient l'une l'autre.
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
        <div className="text-xs text-muted-foreground">{t('notifSettings.hint')}</div>
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
