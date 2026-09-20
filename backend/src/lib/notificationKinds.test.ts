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
 * Le registre vit en deux copies (un paquet ne peut pas importer les sources de l'autre).
 * Ce test est le seul garde-fou : une copie amendée sans l'autre ferait un écran de profil
 * qui propose un réglage que le serveur ne lit pas, ou l'inverse.
 */
const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'v2');
const FRONT_COPY = path.join(FRONT, 'lib', 'notificationKinds.ts');
const FRONT_TARGET = path.join(FRONT, 'components', 'notifications', 'notificationTarget.ts');

/**
 * Les identifiants du tableau `NOM = [ … ] as const` d'une source TypeScript. Découpage à
 * la main plutôt qu'expression rationnelle construite : la liste est un littéral simple, et
 * une expression bâtie sur un nom de constante se lit moins bien qu'elle ne s'écrit.
 */
function listedIn(source: string, name: string): string[] {
  const open = source.indexOf(`export const ${name} = [`);
  if (open < 0) return [];
  const close = source.indexOf('] as const;', open);
  if (close < 0) return [];
  const body = source.slice(open, close);
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe('registre des genres de notification', () => {
  const front = readFileSync(FRONT_COPY, 'utf8');

  it('liste les mêmes genres, dans le même ordre, des deux côtés', () => {
    expect(listedIn(front, 'NOTIFICATION_KINDS')).toEqual([...NOTIFICATION_KINDS]);
  });

  it('liste les mêmes canaux des deux côtés', () => {
    expect(listedIn(front, 'NOTIFICATION_CHANNELS')).toEqual([...NOTIFICATION_CHANNELS]);
  });

  it('fait reconnaître chaque type par la destination du clic', () => {
    // Le défaut d'origine, en une phrase : un type que le front ne cite nulle part tombe sur
    // le repli « page du projet », et le clic a l'air d'avoir marché. Le contrôle est
    // textuel à dessein — c'est la citation du type dans le code du front qui manquait.
    const target = readFileSync(FRONT_TARGET, 'utf8');
    for (const kind of NOTIFICATION_KINDS) {
      const type = NOTIFICATION_TYPE[kind];
      expect(target.includes(`'${type}'`), `${type} est inconnu de notificationTarget.ts`).toBe(true);
    }
  });

  it('associe un type distinct à chaque genre', () => {
    const types = NOTIFICATION_KINDS.map((k) => NOTIFICATION_TYPE[k]);
    expect(new Set(types).size).toBe(NOTIFICATION_KINDS.length);
    // Tous en capitales : c'est la faute d'origine de `review_decision`, que le front ne
    // reconnaissait pas et renvoyait donc sur la page projet au lieu de la review.
    for (const type of types) expect(type).toBe(type.toUpperCase());
  });
});

describe('channelEnabled', () => {
  it('laisse passer quand rien n’est réglé', () => {
    expect(channelEnabled(null, 'mention', 'inApp')).toBe(true);
    expect(channelEnabled({}, 'mention', 'push')).toBe(true);
    expect(channelEnabled({ notifications: {} }, 'mention', 'inApp')).toBe(true);
  });

  it('ne ferme que sur un `false` explicite, canal par canal', () => {
    const prefs = { notifications: { mention: { push: false } } };
    expect(channelEnabled(prefs, 'mention', 'push')).toBe(false);
    expect(channelEnabled(prefs, 'mention', 'inApp')).toBe(true);
    expect(channelEnabled(prefs, 'reply', 'push')).toBe(true);
  });

  it('ignore un sac déformé plutôt que de faire taire la notification', () => {
    expect(channelEnabled({ notifications: 'oui' }, 'mention', 'inApp')).toBe(true);
    expect(channelEnabled({ notifications: { mention: 7 } }, 'mention', 'inApp')).toBe(true);
  });
});

describe('notificationSettingsSchema', () => {
  it('accepte un réglage partiel', () => {
    expect(notificationSettingsSchema.safeParse({ watch: { inApp: false } }).success).toBe(true);
    expect(notificationSettingsSchema.safeParse({}).success).toBe(true);
  });

  it('refuse un genre inconnu et un canal inventé', () => {
    expect(notificationSettingsSchema.safeParse({ gossip: { inApp: false } }).success).toBe(false);
    expect(notificationSettingsSchema.safeParse({ watch: { sms: false } }).success).toBe(false);
    expect(notificationSettingsSchema.safeParse({ watch: { inApp: 'no' } }).success).toBe(false);
  });
});
