// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  NOTIFICATION_TYPE,
  channelEnabled,
  notificationSettingsSchema,
} from './notificationKinds';

/**
 * The registry lives in two copies (one package cannot import the sources of the other). This test is the only guard:
 * a copy amended without the other would produce a profile screen offering a setting the server does not read, or the reverse.
 */
const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'v2');
const FRONT_COPY = path.join(FRONT, 'lib', 'notificationKinds.ts');
const FRONT_TARGET = path.join(FRONT, 'components', 'notifications', 'notificationTarget.ts');

/**
 * The identifiers of the `NAME = [ … ] as const` array of a TypeScript source. Split by hand rather than with a built
 * regular expression: the list is a simple literal, and an expression built on a constant name reads worse than it writes.
 */
function listedIn(source: string, name: string): string[] {
  const open = source.indexOf(`export const ${name} = [`);
  if (open < 0) return [];
  const close = source.indexOf('] as const;', open);
  if (close < 0) return [];
  const body = source.slice(open, close);
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe('notification kinds registry', () => {
  const front = readFileSync(FRONT_COPY, 'utf8');

  it('lists the same kinds, in the same order, on both sides', () => {
    expect(listedIn(front, 'NOTIFICATION_KINDS')).toEqual([...NOTIFICATION_KINDS]);
  });

  it('lists the same channels on both sides', () => {
    expect(listedIn(front, 'NOTIFICATION_CHANNELS')).toEqual([...NOTIFICATION_CHANNELS]);
  });

  it('makes each type recognised by the click destination', () => {
    // The original defect, in one sentence: a type the front end cites nowhere falls back to the "project page" and the
    // click looks as if it worked. The check is textual on purpose — it is the citation of the type in the front-end code that was missing.
    const target = readFileSync(FRONT_TARGET, 'utf8');
    for (const kind of NOTIFICATION_KINDS) {
      const type = NOTIFICATION_TYPE[kind];
      expect(target.includes(`'${type}'`), `${type} est inconnu de notificationTarget.ts`).toBe(true);
    }
  });

  it('associates a distinct type with each kind', () => {
    const types = NOTIFICATION_KINDS.map((k) => NOTIFICATION_TYPE[k]);
    expect(new Set(types).size).toBe(NOTIFICATION_KINDS.length);
    // All in capitals: that is the original fault of `review_decision`, which the front end did not recognise and therefore
    // sent to the project page instead of the review.
    for (const type of types) expect(type).toBe(type.toUpperCase());
  });
});

describe('channelEnabled', () => {
  it('lets through when nothing is set', () => {
    expect(channelEnabled(null, 'mention', 'inApp')).toBe(true);
    expect(channelEnabled({}, 'mention', 'push')).toBe(true);
    expect(channelEnabled({ notifications: {} }, 'mention', 'inApp')).toBe(true);
  });

  it('closes only on an explicit `false`, channel by channel', () => {
    const prefs = { notifications: { mention: { push: false } } };
    expect(channelEnabled(prefs, 'mention', 'push')).toBe(false);
    expect(channelEnabled(prefs, 'mention', 'inApp')).toBe(true);
    expect(channelEnabled(prefs, 'reply', 'push')).toBe(true);
  });

  it('ignores a malformed bag rather than silencing the notification', () => {
    expect(channelEnabled({ notifications: 'oui' }, 'mention', 'inApp')).toBe(true);
    expect(channelEnabled({ notifications: { mention: 7 } }, 'mention', 'inApp')).toBe(true);
  });
});

describe('notificationSettingsSchema', () => {
  it('accepts a partial setting', () => {
    expect(notificationSettingsSchema.safeParse({ watch: { inApp: false } }).success).toBe(true);
    expect(notificationSettingsSchema.safeParse({}).success).toBe(true);
  });

  it('refuses an unknown kind and an invented channel', () => {
    expect(notificationSettingsSchema.safeParse({ gossip: { inApp: false } }).success).toBe(false);
    expect(notificationSettingsSchema.safeParse({ watch: { sms: false } }).success).toBe(false);
    expect(notificationSettingsSchema.safeParse({ watch: { inApp: 'no' } }).success).toBe(false);
  });
});
