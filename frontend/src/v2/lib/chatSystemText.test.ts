// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { chatSystemText } from './chatSystemText';
import type { MessageKey, TParams } from '../i18n';

/** Test translator: returns the key and its parameters, without depending on a catalogue. */
const t = (key: MessageKey, params?: TParams) =>
  params ? `${key}(${Object.values(params).join(',')})` : String(key);

describe('chatSystemText', () => {
  it('translates the system message key with its variables', () => {
    expect(
      chatSystemText(t, {
        systemKey: 'chat.system.renamed',
        systemVars: { title: 'Séquence 12' },
        body: 'The group is now called « Séquence 12 »',
      }),
    ).toBe('chat.system.renamed(Séquence 12)');
  });

  it('returns the body as is for a written message', () => {
    // A message typed by someone has no language to choose: translating it would be
    // rewriting it.
    expect(chatSystemText(t, { systemKey: null, systemVars: null, body: 'Bonjour' })).toBe('Bonjour');
  });

  it('falls back to the stored body for a message predating the key', () => {
    // Messages posted before this change carry the French sentence in the database: without
    // this fallback, the thread would show nothing where there was a trace.
    expect(
      chatSystemText(t, { systemKey: null, systemVars: null, body: 'Alice a quitté la conversation' }),
    ).toBe('Alice a quitté la conversation');
  });

  it('also falls back to the body when the key is unknown to the catalogue', () => {
    // A server newer than the open tab: English is better than an identifier.
    expect(
      chatSystemText(
        t,
        { systemKey: 'chat.system.futur', systemVars: { name: 'Alice' }, body: 'Alice did something' },
        () => false,
      ),
    ).toBe('Alice did something');
  });

  it('returns the bare key when it has no variable', () => {
    expect(chatSystemText(t, { systemKey: 'chat.system.left', systemVars: null, body: 'Alice left' })).toBe(
      'chat.system.left',
    );
  });
});
