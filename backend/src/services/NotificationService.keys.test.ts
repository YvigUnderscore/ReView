// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Contrôle croisé : toute clé de message émise par le backend existe côté frontend.
 *
 * Le backend ne rend pas ses notifications, il n'en pose que la clé et ses paramètres ; le
 * navigateur les traduit. Une clé émise mais absente du catalogue s'affiche donc telle
 * quelle dans le panneau de notifications — c'est ce qui arrivait à
 * `notification.clientComment` : chaque retour d'un client produisait une ligne illisible.
 *
 * `check-untranslated.mjs` ne pouvait pas l'attraper : il cherche du texte en dur dans le
 * code, pas une clé émise ici et attendue là-bas.
 */

const BACKEND_SRC = path.join(__dirname, '..');
const FRONT_CATALOG = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'frontend',
  'src',
  'v2',
  'i18n',
  'messages',
  'en.json',
);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (name.endsWith('.ts') && !name.includes('.test.') && !name.includes('.itest.')) out.push(full);
  }
  return out;
}

describe('clés de message émises par le backend', () => {
  const catalog = JSON.parse(readFileSync(FRONT_CATALOG, 'utf8')) as Record<string, unknown>;

  // `messageKey: 'notification.x'` et les littéraux `'notification.x'` passés aux notifieurs.
  const emitted = new Set<string>();
  for (const file of sources(BACKEND_SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/'(notification\.[a-zA-Z][\w.]*)'/g)) {
      if (m[1]) emitted.add(m[1]);
    }
  }

  it('en émet au moins dix (le détecteur trouve bien quelque chose)', () => {
    expect(emitted.size).toBeGreaterThanOrEqual(10);
  });

  for (const key of [...emitted].sort()) {
    it(`${key} existe dans le catalogue anglais`, () => {
      expect(catalog[key], `${key} est émise par le backend mais absente de en.json`).toBeDefined();
    });
  }
});
