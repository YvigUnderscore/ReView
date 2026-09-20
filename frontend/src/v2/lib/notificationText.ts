// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Notification } from '../types/api';
import { hasMessage, type MessageKey, type TParams } from '../i18n';

/**
 * Phrase d'une notification, dans la langue du lecteur (D2).
 *
 * Elle était écrite en français **en base** au moment de l'événement, puis servie telle
 * quelle à tout le monde — un studio japonais lisait « Tâche assignée ». Le serveur
 * enregistre désormais une clé et ses paramètres ; `content` reste renvoyé, en anglais,
 * et sert de repli aux notifications antérieures à ce changement.
 *
 * Ce repli était **mort en production** : `isKnownKey` valait `() => true` par défaut et
 * aucun appelant ne passait autre chose, si bien qu'une clé inconnue du catalogue — un
 * serveur plus récent que l'onglet ouvert, un déploiement en cours — s'affichait telle
 * quelle : le lecteur voyait « notification.reviewNoteUpdated » là où `content` portait
 * déjà la phrase anglaise. Le défaut est désormais `hasMessage`, et le paramètre ne reste
 * que pour le test.
 */
export function notificationText(
  t: (key: MessageKey, params?: TParams) => string,
  notification: Pick<Notification, 'messageKey' | 'params' | 'content'>,
  isKnownKey: (key: string) => boolean = hasMessage,
): string {
  const key = notification.messageKey;
  if (!key || !isKnownKey(key)) return notification.content;
  return t(key as MessageKey, notification.params ?? undefined);
}
