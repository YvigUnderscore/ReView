// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { chatSystemText } from './chatSystemText';
import type { MessageKey, TParams } from '../i18n';

/** Traducteur de test : rend la clé et ses paramètres, sans dépendre d'un catalogue. */
const t = (key: MessageKey, params?: TParams) =>
  params ? `${key}(${Object.values(params).join(',')})` : String(key);

describe('chatSystemText', () => {
  it('traduit la clé du message de service avec ses variables', () => {
    expect(
      chatSystemText(t, {
        systemKey: 'chat.system.renamed',
        systemVars: { title: 'Séquence 12' },
        body: 'The group is now called « Séquence 12 »',
      }),
    ).toBe('chat.system.renamed(Séquence 12)');
  });

  it('rend le corps tel quel pour un message écrit', () => {
    // Un message tapé par quelqu'un n'a pas de langue à choisir : le traduire serait le
    // réécrire.
    expect(chatSystemText(t, { systemKey: null, systemVars: null, body: 'Bonjour' })).toBe('Bonjour');
  });

  it('retombe sur le corps enregistré pour un message antérieur à la clé', () => {
    // Les messages postés avant ce changement portent la phrase française en base : sans
    // ce repli, le fil afficherait du vide là où il y avait une trace.
    expect(
      chatSystemText(t, { systemKey: null, systemVars: null, body: 'Alice a quitté la conversation' }),
    ).toBe('Alice a quitté la conversation');
  });

  it('retombe aussi sur le corps quand la clé est inconnue du catalogue', () => {
    // Un serveur plus récent que l'onglet ouvert : mieux vaut l'anglais qu'un identifiant.
    expect(
      chatSystemText(
        t,
        { systemKey: 'chat.system.futur', systemVars: { name: 'Alice' }, body: 'Alice did something' },
        () => false,
      ),
    ).toBe('Alice did something');
  });

  it('rend la clé seule quand elle n’a pas de variable', () => {
    expect(chatSystemText(t, { systemKey: 'chat.system.left', systemVars: null, body: 'Alice left' })).toBe(
      'chat.system.left',
    );
  });
});
