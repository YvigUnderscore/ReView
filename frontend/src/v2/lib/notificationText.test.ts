// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { notificationText } from './notificationText';
import type { MessageKey, TParams } from '../i18n';

/** Traducteur de test : rend la clé et ses paramètres, sans dépendre d'un catalogue. */
const t = (key: MessageKey, params?: TParams) =>
  params ? `${key}(${Object.values(params).join(',')})` : String(key);

describe('notificationText', () => {
  it('traduit la clé avec ses paramètres', () => {
    expect(
      notificationText(t, {
        messageKey: 'notification.taskAssigned',
        params: { name: 'comp SH010' },
        content: 'Task assigned: comp SH010',
      }),
    ).toBe('notification.taskAssigned(comp SH010)');
  });

  it('retombe sur le texte enregistré pour une notification antérieure', () => {
    // Les lignes créées avant D2 ne portent pas de clé : sans ce repli, la cloche
    // afficherait du vide là où il y avait une phrase.
    expect(notificationText(t, { messageKey: null, content: 'Tâche assignée : comp' })).toBe(
      'Tâche assignée : comp',
    );
    expect(notificationText(t, { content: 'Ancienne phrase' })).toBe('Ancienne phrase');
  });

  it('retombe aussi sur le texte quand la clé est inconnue du catalogue', () => {
    // Un serveur plus récent que l'onglet ouvert : mieux vaut l'anglais qu'un identifiant.
    expect(
      notificationText(t, { messageKey: 'notification.futur', content: 'Something happened' }, () => false),
    ).toBe('Something happened');
  });

  it('rend la clé seule quand elle n’a pas de paramètre', () => {
    expect(notificationText(t, { messageKey: 'notification.reply', content: 'New reply' })).toBe(
      'notification.reply',
    );
  });
});
