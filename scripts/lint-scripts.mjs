// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lint des scripts d'outillage de la racine (`scripts/*.mjs`).
 *
 * Passe par l'API Node d'ESLint plutôt que par le binaire : ESLint ne sait pas
 * appliquer une configuration à des fichiers situés hors de son répertoire de
 * base, or la configuration du dépôt vit dans `backend/` et les scripts à la
 * racine. On emprunte donc l'ESLint du backend (aucune dépendance nouvelle) en
 * lui donnant la racine comme base et une config plate posée ici même.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireBackend = createRequire(path.join(ROOT, 'backend', 'package.json'));
const { ESLint } = requireBackend('eslint');
const js = requireBackend('@eslint/js');
const globals = requireBackend('globals');

/**
 * Linte les cibles données (répertoires ou fichiers `.mjs`) et rend les résultats
 * bruts, leur rendu « stylish » et le total d'erreurs. `cwd` sert de répertoire de
 * base à ESLint : les cibles doivent vivre dessous.
 */
export async function lintScripts(targets = [path.join(ROOT, 'scripts')], cwd = ROOT) {
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.mjs'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
        rules: {
          ...js.configs.recommended.rules,
          'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
      },
    ],
  });
  const results = await eslint.lintFiles(targets);
  const formatter = await eslint.loadFormatter('stylish');
  const output = await formatter.format(results);
  const errorCount = results.reduce((n, r) => n + r.errorCount + r.warningCount, 0);
  return { results, output, errorCount };
}

// Exécuté directement (et non importé par un test) → on lance.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { output, errorCount } = await lintScripts();
  if (output.trim()) console.log(output);
  if (errorCount > 0) process.exit(1);
  console.log('\x1b[0;32m✓ scripts racine : aucune erreur ESLint\x1b[0m');
}
