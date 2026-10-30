// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lints the root tooling scripts (`scripts/*.mjs`).
 *
 * Goes through ESLint's Node API rather than the binary: ESLint cannot
 * apply a configuration to files located outside its base
 * directory, yet the repository configuration lives in `backend/` and the scripts at the
 * root. We therefore borrow the backend's ESLint (no new dependency) by
 * giving it the root as base and a flat config placed right here.
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
 * Lints the given targets (directories or `.mjs` files) and returns the raw results,
 * their "stylish" rendering and the error total. `cwd` serves as the ESLint
 * base directory: the targets must live under it.
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

// Run directly (and not imported by a test) → launch it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { output, errorCount } = await lintScripts();
  if (output.trim()) console.log(output);
  if (errorCount > 0) process.exit(1);
  console.log('\x1b[0;32m✓ scripts racine : aucune erreur ESLint\x1b[0m');
}
