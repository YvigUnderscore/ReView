// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Detects **translation keys that nobody cites any more** — the opposite of `check-raw-keys.mjs`
 * (key displayed as is) and of `check-untranslated.mjs` (text never passed through `t()`).
 *
 * A dead key breaks nothing: it costs. Each one is written fourteen times, and one more language means
 * fourteen more translations to produce, proofread and maintain for text nobody will display.
 * `check-translations.mjs` only sees the symmetric fault (key present in one language and absent from
 * `en.json`).
 *
 * The check reads the AST rather than the text of the files, to tell apart two forms:
 *   1. the direct citation — `t('shots.add')`: the key appears as is;
 *   2. the **built** key — `` t(`shotgrid.domain.${d}`) ``, `'admin.group.' + g`: nothing in the code
 *      cites the final key. The literal prefix (`shotgrid.domain.`) is then recorded, and any key
 *      below it is taken as used. A prefix is therefore a **family** — the accepted counterpart of
 *      dynamic construction.
 *
 * The total is compared to a ceiling (`CEILING`). Lower the ceiling when going down, never the other way.
 *
 * Usage: node scripts/check-unused-keys.mjs [--list] [--set=frontend|backend]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Paths anchored on the repository root and not on the current directory: the backend
// vitest suite runs this file from `backend/`.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...parts) => join(repoRoot, ...parts);

const ts = createRequire(at('frontend', 'package.json'))('typescript');

/** Tolerated remainder of dead keys — debt to be paid down, never raised. */
const CEILING = 0;

/**
 * A set = a reference catalogue and the sources that use it.
 *
 * The backend cites keys **of the front-end catalogue**: a notification and a ShotGrid journal line
 * travel as a key (`messageKey: 'notification.mentioned'`) and are translated at display time, in the
 * reader's language rather than the server's. Its sources therefore count for the frontend set — ignoring
 * them would declare some fifty perfectly alive keys dead.
 */
export const SETS = [
  {
    name: 'frontend',
    catalog: at('frontend/src/v2/i18n/messages/en.json'),
    roots: [at('frontend/src'), at('backend/src')],
  },
  {
    name: 'backend',
    catalog: at('backend/src/i18n/messages/en.json'),
    roots: [at('backend/src')],
  },
];

/** Keys of the reference catalogue, flattened. */
export const catalogKeys = (file) => Object.keys(JSON.parse(readFileSync(file, 'utf8')));

/**
 * Citations found in a source: whole keys and prefixes of built keys.
 *
 * No filter on the caller: a key may travel through a constant (`const KEY =
 * 'task.status.todo'`), a `…Key` prop, an array or a test. What matters is that it is **named**
 * somewhere; the opposite fault (key never translated) has its own check.
 */
export function citations(source, fileName = 'x.ts') {
  const src = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const exact = new Set();
  const prefixes = new Set();

  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      exact.add(node.text);
      // `'admin.group.' + name` — concatenation is the other way of building a key.
      if (node.text.endsWith('.') && ts.isBinaryExpression(node.parent)) prefixes.add(node.text);
    } else if (ts.isTemplateExpression(node)) {
      // `` `shotgrid.entity.${kind}` `` — only the head is a literal.
      if (node.head.text.includes('.')) prefixes.add(node.head.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return { exact, prefixes };
}

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // The catalogues themselves cite nothing: they *are* the keys.
      if (entry !== 'messages' && entry !== 'node_modules' && entry !== 'dist') yield* sources(full);
    } else if (/\.(tsx?|mjs)$/.test(entry)) {
      yield full;
    }
  }
}

/** Catalogue keys that no source cites, neither whole nor by prefix. */
export function unusedKeys(set) {
  const exact = new Set();
  const prefixes = new Set();
  for (const root of set.roots) {
    for (const file of sources(root)) {
      const found = citations(readFileSync(file, 'utf8'), file);
      for (const value of found.exact) exact.add(value);
      for (const value of found.prefixes) prefixes.add(value);
    }
  }
  return catalogKeys(set.catalog).filter(
    (key) => !exact.has(key) && ![...prefixes].some((p) => key.startsWith(p)),
  );
}

function main() {
  const only = process.argv.find((a) => a.startsWith('--set='))?.slice('--set='.length);
  const sets = SETS.filter((s) => !only || s.name === only);
  let total = 0;
  for (const set of sets) {
    const dead = unusedKeys(set);
    total += dead.length;
    console.log(
      `${set.name} : ${dead.length} clé(s) morte(s) sur ${catalogKeys(set.catalog).length} ` +
        `(${relative(repoRoot, set.catalog).split(sep).join('/')})`,
    );
    if (process.argv.includes('--list')) for (const key of dead) console.log('   ', key);
  }

  const ok = total <= CEILING;
  const color = ok ? '\x1b[0;32m' : '\x1b[0;31m';
  console.log(`${color}${ok ? '✓' : '✗'} clés de traduction mortes : ${total} (plafond ${CEILING})\x1b[0m`);
  if (!ok) console.error('  Relancer avec --list, puis retirer les clés des quatorze catalogues.');
  process.exit(ok ? 0 : 1);
}

// Importable for the tests; only runs when called directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
