// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Cross-check: every message key emitted by the backend exists on the frontend.
 *
 * The backend does not render its notifications; it only sets the key and its parameters, and the browser
 * translates them. A key that is emitted but absent from the catalogue would therefore be
 * displayed as-is in the notifications panel — this is what happened with `notification.clientComment`: each
 * client feedback produced an unreadable line.
 *
 * `check-untranslated.mjs` could not catch it: it searches for hard-coded text in the code, not for a key
 * emitted here and expected there.
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

describe('message keys emitted by the backend', () => {
  const catalog = JSON.parse(readFileSync(FRONT_CATALOG, 'utf8')) as Record<string, unknown>;

  // `messageKey: 'notification.x'` and the `'notification.x'` literals passed to the notifiers.
  const emitted = new Set<string>();
  for (const file of sources(BACKEND_SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/'(notification\.[a-zA-Z][\w.]*)'/g)) {
      if (m[1]) emitted.add(m[1]);
    }
  }

  it('emits at least ten (the detector does find something)', () => {
    expect(emitted.size).toBeGreaterThanOrEqual(10);
  });

  for (const key of [...emitted].sort()) {
    it(`${key} exists in the English catalogue`, () => {
      expect(catalog[key], `${key} est émise par le backend mais absente de en.json`).toBeDefined();
    });
  }
});
