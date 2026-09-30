// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChatSystemPhrase } from '../types/chat';
import type { MessageKey, TParams } from '../i18n';

/**
 * Phrase d'un message de la messagerie, dans la langue du lecteur.
 *
 * Un message écrit n'a rien à traduire : il rend son corps, tel qu'il a été tapé. Un
 * message de service (arrivée, départ, renommage), lui, était écrit **en français en
 * base** au moment de l'événement, puis servi tel quel à tout le monde — un studio
 * japonais lisait « a rejoint la conversation », et rien ne pouvait plus le retraduire.
 * Le serveur enregistre désormais une clé et ses variables ; `body` reste renvoyé, en
 * anglais, et sert de repli aux messages antérieurs à ce changement.
 *
 * Même contrat que `notificationText` — les deux surfaces ont la même dette et le même
 * repli.
 */
export function chatSystemText(
  t: (key: MessageKey, params?: TParams) => string,
  message: ChatSystemPhrase,
  isKnownKey: (key: string) => boolean = () => true,
): string {
  const key = message.systemKey;
  if (!key || !isKnownKey(key)) return message.body;
  return t(key as MessageKey, message.systemVars ?? undefined);
}
