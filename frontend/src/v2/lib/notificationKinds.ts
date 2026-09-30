// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Registre des types d'événement notifiables — **copie à l'identique** de
 * `backend/src/lib/notificationKinds.ts`, dont `notificationKinds.test.ts` (côté backend)
 * refuse la divergence. Même contrat que `i18n/locales.json` : deux paquets, une liste.
 *
 * Le front n'en a pas besoin pour afficher une notification (il lit son `type`), mais pour
 * offrir le réglage : l'écran de profil ne doit pas proposer un genre que `notify()` ne
 * consulte pas, ni taire un genre qu'il consulte.
 */
export const NOTIFICATION_KINDS = [
  'mention',
  'reply',
  'commentAssigned',
  'taskAssigned',
  'reviewAssigned',
  'reviewDecision',
  'watch',
  'live',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Les deux voies d'arrivée réglables : le panneau in-app et la notification navigateur. */
export const NOTIFICATION_CHANNELS = ['inApp', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Clé de premier niveau du sac de préférences où vivent ces réglages. */
export const NOTIFICATION_SETTINGS_KEY = 'notifications';

export type NotificationSettings = Partial<Record<NotificationKind, { inApp?: boolean; push?: boolean }>>;

/**
 * Ce canal est-il ouvert pour ce genre ? Même règle qu'au serveur : seul un `false`
 * explicite ferme, tout le reste laisse passer. La case cochée est donc l'état par défaut.
 */
export function channelEnabled(
  settings: NotificationSettings | undefined,
  kind: NotificationKind,
  channel: NotificationChannel,
): boolean {
  return settings?.[kind]?.[channel] !== false;
}

/**
 * Sac de réglages après bascule d'un canal — renvoyé tel quel au `PATCH` de préférences.
 *
 * La fusion du serveur est **superficielle** : elle remplace `notifications` en entier.
 * D'où la recopie de tout le sac ici, sans quoi cocher une case en effacerait toutes les
 * autres.
 */
export function withChannel(
  settings: NotificationSettings | undefined,
  kind: NotificationKind,
  channel: NotificationChannel,
  enabled: boolean,
): NotificationSettings {
  return { ...settings, [kind]: { ...settings?.[kind], [channel]: enabled } };
}
