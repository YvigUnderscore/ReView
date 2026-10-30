// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ici = path.dirname(fileURLToPath(import.meta.url));
const lire = (fichier: string) => readFileSync(path.join(ici, fichier), 'utf8');

/**
 * Architecture guard, not behaviour.
 *
 * `IconButton` is on the entry path: everything it imports statically goes into the
 * **first load**. When Radix Tooltip was there, the budget went from 419 to 429.8 kB against
 * a ceiling of 430 — 0.2 kB of margin, and the next change, whatever it was, made the suite fail.
 *
 * The facade exists for this and for nothing else. It is short, it looks like a pointless
 * indirection, and someone will one day "simplify" it by importing Radix directly — the budget
 * would only complain at the next commit, about an unrelated change. This test says so at once, and says why.
 */
describe('the tooltip facade keeps Radix out of the first load', () => {
  it('imports Radix only dynamically', () => {
    const facade = lire('tooltip.tsx');
    expect(facade).not.toMatch(/import\s+[^;]*from\s+['"]@radix-ui\/react-tooltip['"]/);
    // The dynamic import, on the other hand, is expected: it is the mechanism itself.
    expect(facade).toMatch(/import\(['"]\.\/tooltip\.radix['"]\)/);
  });

  it('keeps the Radix implementation in a separate module', () => {
    expect(lire('tooltip.radix.tsx')).toMatch(/from ['"]@radix-ui\/react-tooltip['"]/);
  });

  /**
   * `IconButton` is the only universal entry point: if it imported the implementation, the
   * facade would be pointless.
   */
  it('is never short-circuited by IconButton', () => {
    const bouton = lire('icon-button.tsx');
    expect(bouton).toMatch(/from ['"]\.\/tooltip['"]/);
    expect(bouton).not.toMatch(/tooltip\.radix/);
    expect(bouton).not.toMatch(/@radix-ui\/react-tooltip/);
  });
});
