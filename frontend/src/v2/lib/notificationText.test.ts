// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { notificationText } from './notificationText';
import type { MessageKey, TParams } from '../i18n';

/** Test translator: returns the key and its parameters, without depending on a catalogue. */
const t = (key: MessageKey, params?: TParams) =>
  params ? `${key}(${Object.values(params).join(',')})` : String(key);

describe('notificationText', () => {
  it('translates the key with its parameters', () => {
    expect(
      notificationText(t, {
        messageKey: 'notification.taskAssigned',
        params: { name: 'comp SH010' },
        content: 'Task assigned: comp SH010',
      }),
    ).toBe('notification.taskAssigned(comp SH010)');
  });

  it('falls back to the stored text for an earlier notification', () => {
    // Rows created before D2 carry no key: without this fallback, the bell would display nothing
    // where there was a sentence.
    expect(notificationText(t, { messageKey: null, content: 'Tâche assignée : comp' })).toBe(
      'Tâche assignée : comp',
    );
    expect(notificationText(t, { content: 'Ancienne phrase' })).toBe('Ancienne phrase');
  });

  it('also falls back to the text when the key is unknown to the catalogue', () => {
    // A server newer than the open tab: English is better than an identifier.
    expect(
      notificationText(t, { messageKey: 'notification.futur', content: 'Something happened' }, () => false),
    ).toBe('Something happened');
  });

  it('returns the bare key when it has no parameter', () => {
    expect(notificationText(t, { messageKey: 'notification.reply', content: 'New reply' })).toBe(
      'notification.reply',
    );
  });
});
