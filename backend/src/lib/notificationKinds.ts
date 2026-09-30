// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

/**
 * Registre des **types d'événement** notifiables — la liste que le profil personnel offre
 * à régler, et celle que `notify()` consulte avant d'écrire quoi que ce soit.
 *
 * Il existe parce que `User.preferences` est un sac JSON sans schéma : sans registre, un
 * réglage par événement se serait écrit avec une clé inventée à chaque appel, personne
 * n'aurait pu en dresser la liste, et l'écran de profil aurait affiché ce qu'il croyait
 * plutôt que ce que le serveur lit. Le registre est **recopié à l'identique côté front**
 * (`frontend/src/v2/lib/notificationKinds.ts`), et `notificationKinds.test.ts` refuse que
 * les deux copies divergent — même contrat que `i18n/locales.json`.
 *
 * Le `type` de la notification (celui que le navigateur lit pour choisir l'icône et la
 * destination du clic) se **dérive** du genre : c'était auparavant une chaîne libre passée
 * à chaque appel, et c'est ainsi qu'une décision de review avait fini par s'écrire
 * `review_decision` là où tout le reste est en capitales — un type que le front ne
 * reconnaissait pas, donc un clic qui n'ouvrait jamais la review.
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

/** Genre → `Notification.type` servi au navigateur. Un genre, un type, sans exception. */
export const NOTIFICATION_TYPE: Record<NotificationKind, string> = {
  mention: 'MENTION',
  reply: 'REPLY',
  commentAssigned: 'COMMENT_ASSIGNED',
  taskAssigned: 'TASK_ASSIGNED',
  reviewAssigned: 'REVIEW_ASSIGNED',
  reviewDecision: 'REVIEW_DECISION',
  watch: 'WATCH',
  live: 'LIVE',
};

/** Clé de premier niveau du sac de préférences où vivent ces réglages. */
export const NOTIFICATION_SETTINGS_KEY = 'notifications';

/** Un genre réglé : chaque canal absent vaut « activé ». */
const kindSchema = z.object({ inApp: z.boolean().optional(), push: z.boolean().optional() }).strict();

/**
 * Forme admissible de `preferences.notifications`.
 *
 * La clé est contrôlée par un `refine` et non par `z.record(z.enum(...))` : un genre retiré
 * du registre ne doit pas rendre INVALIDE le sac d'un compte qui l'avait réglé — l'inconnu
 * se refuse à l'écriture, pas à la lecture (`channelEnabled` ignore ce qu'il ne connaît pas).
 */
export const notificationSettingsSchema = z
  .record(z.string().max(32), kindSchema)
  .refine((value) => Object.keys(value).every((k) => (NOTIFICATION_KINDS as readonly string[]).includes(k)), {
    message: 'Unknown notification kind',
  });

export type NotificationSettings = Partial<Record<NotificationKind, { inApp?: boolean; push?: boolean }>>;

/**
 * Ce canal est-il ouvert pour ce genre, chez ce destinataire ?
 *
 * **Seul un `false` explicite ferme.** Tout le reste — sac absent, genre jamais réglé,
 * valeur d'une forme inattendue — laisse passer : un réglage illisible ne doit pas faire
 * taire en silence une notification que personne n'a demandé à taire, et un genre ajouté
 * plus tard arrive donc activé pour tout le monde.
 */
export function channelEnabled(
  preferences: unknown,
  kind: NotificationKind,
  channel: NotificationChannel,
): boolean {
  if (!preferences || typeof preferences !== 'object') return true;
  const bag = (preferences as Record<string, unknown>)[NOTIFICATION_SETTINGS_KEY];
  if (!bag || typeof bag !== 'object') return true;
  const entry = (bag as Record<string, unknown>)[kind];
  if (!entry || typeof entry !== 'object') return true;
  return (entry as Record<string, unknown>)[channel] !== false;
}
