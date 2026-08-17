// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { lintScripts } from './lint-scripts.mjs';

/** Répertoire jetable : ESLint lit sur disque, et `cwd` doit contenir les cibles. */
const dir = mkdtempSync(join(tmpdir(), 'review-lint-scripts-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const write = (name, source) => {
  const file = join(dir, name);
  writeFileSync(file, source, 'utf8');
  return file;
};

describe('lintScripts', () => {
  it('signale une variable inutilisée', async () => {
    const file = write('fautif.mjs', "const inutile = 1;\nexport const ok = () => 'ok';\n");
    const { errorCount, results } = await lintScripts([file], dir);
    expect(errorCount).toBe(1);
    expect(results[0].messages[0].ruleId).toBe('no-unused-vars');
  });

  it('ne dit rien d’un script propre', async () => {
    const file = write('propre.mjs', 'export const somme = (a, b) => a + b;\n');
    const { errorCount, output } = await lintScripts([file], dir);
    expect(errorCount).toBe(0);
    expect(output.trim()).toBe('');
  });

  it('tolère un paramètre inutilisé préfixé par un souligné', async () => {
    const file = write('souligne.mjs', 'export const f = (_ignore, valeur) => valeur;\n');
    const { errorCount } = await lintScripts([file], dir);
    expect(errorCount).toBe(0);
  });

  it('connaît les globales Node — `process` n’est pas une variable inconnue', async () => {
    const file = write('node-globals.mjs', 'export const cwd = () => process.cwd();\n');
    const { errorCount } = await lintScripts([file], dir);
    expect(errorCount).toBe(0);
  });

  it('relève une vraie faute de syntaxe d’usage (double déclaration)', async () => {
    const file = write('double.mjs', 'const a = 1;\nconst a = 2;\nexport { a };\n');
    const { errorCount } = await lintScripts([file], dir);
    expect(errorCount).toBeGreaterThan(0);
  });
});
