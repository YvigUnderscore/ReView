// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Adds a batch of keys to the fourteen catalogues at once.
 *
 * A key only exists if it is present in the fourteen languages: fourteen manual edits
 * are fourteen chances to forget one — and the forgotten key only shows up on
 * screen, in the language nobody proofreads. This script takes the batch once and writes it
 * partout.
 *
 * Usage :
 *   node scripts/i18n-add.mjs <lot.json> [--set=frontend|backend]
 *
 * Batch format — one entry per key, one entry per language, plain value or plural forms
 * plurielles :
 *   {
 *     "admin.title": { "en": "Administration", "fr": "Administration", "ja": "管理", … },
 *     "admin.count": { "en": { "one": "{count} item", "other": "{count} items" }, … }
 *   }
 *
 * The key is inserted after the keys sharing its prefix so that the catalogues stay
 * readable; a key already present is updated in place. The consistency check
 * (`check-translations.mjs`) remains the authority: this script writes, it does not validate.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SETS = {
  frontend: 'frontend/src/v2/i18n/messages',
  backend: 'backend/src/i18n/messages',
};

/** Renders the value as it is written in the catalogue — one key per line, Prettier style. */
export const render = (key, value) => {
  const body =
    typeof value === 'string'
      ? JSON.stringify(value)
      : `{ ${Object.entries(value)
          .map(([form, text]) => `${JSON.stringify(form)}: ${JSON.stringify(text)}`)
          .join(', ')} }`;
  return `  ${JSON.stringify(key)}: ${body},`;
};

/**
 * Merges a batch into the raw text of a catalogue — pure function, nothing is read or
 * written to disk. Returns the new content, the number of writes and the keys whose
 * translation is missing for this language.
 */
export function mergeCatalog(raw, batch, locale) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  let written = 0;
  const missing = [];

  for (const [key, byLocale] of Object.entries(batch)) {
    const value = byLocale[locale];
    if (value === undefined) {
      missing.push(`${locale} ← ${key}`);
      continue;
    }
    const line = render(key, value);
    const existing = lines.findIndex((l) => l.startsWith(`  ${JSON.stringify(key)}:`));
    if (existing >= 0) {
      // The file's last entry has no comma: do not give it one.
      lines[existing] = lines[existing].trimEnd().endsWith(',') ? line : line.slice(0, -1);
      written += 1;
      continue;
    }
    // After the keys sharing the same prefix, otherwise at the end of the catalogue. An entry whose
    // value spans several lines (`"k": {` … `},`) requires targeting its closing:
    // inserting just after the opening brace would break the JSON.
    const prefix = `  "${key.split('.')[0]}.`;
    let at = -1;
    lines.forEach((l, i) => {
      if (l.startsWith(prefix)) at = i;
    });
    // `lines[at]` may be the opening brace of a plural value: we advance up to
    // its closing (` },`), never going past the document's final brace.
    while (at >= 0 && at < lines.length - 1 && /^\s*("[^"]+":\s*)?\{$/.test(lines[at])) {
      while (at < lines.length - 1 && !/^\s+\}/.test(lines[at])) at += 1;
    }
    if (at < 0) {
      // At end of file: the former last entry takes its comma, the new one does not.
      //
      // ⚠ We target the DOCUMENT's final brace, then go up — and not "the last
      // line that starts with a key". The last entry of a catalogue may be
      // plural, hence span several lines and close on `  }`, a shape
      // that neither "starts with two spaces and a quote" nor "is `},`" describes:
      // the search then fell back on the OPENING brace of that last value, and
      // the new key was inserted in the middle of it. The fourteen catalogues became
      // unreadable at once, and the application with them.
      let close = lines.length - 1;
      while (close > 0 && lines[close].trim() !== '}') close -= 1;
      at = close - 1;
      while (at > 0 && lines[at].trim() === '') at -= 1;
      lines[at] = `${lines[at].trimEnd().replace(/,$/, '')},`;
      lines.splice(at + 1, 0, line.slice(0, -1));
    } else {
      lines.splice(at + 1, 0, lines[at].trimEnd().endsWith(',') ? line : line.slice(0, -1));
      if (!lines[at].trimEnd().endsWith(',')) lines[at] = `${lines[at].trimEnd()},`;
    }
    written += 1;
  }

  return { content: lines.join(eol), written, missing };
}

function main() {
  const args = process.argv.slice(2);
  const batchPath = args.find((a) => !a.startsWith('--'));
  const setName = (args.find((a) => a.startsWith('--set=')) ?? '--set=frontend').slice(6);

  if (!batchPath) {
    console.error('usage: node scripts/i18n-add.mjs <lot.json> [--set=frontend|backend]');
    process.exit(2);
  }

  const dir = SETS[setName];
  if (!dir) {
    console.error(`jeu de catalogues inconnu : ${setName} (attendu : ${Object.keys(SETS).join('|')})`);
    process.exit(2);
  }

  const batch = JSON.parse(readFileSync(batchPath, 'utf8'));
  const locales = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));

  let written = 0;
  const missing = [];

  for (const locale of locales) {
    const file = join(dir, `${locale}.json`);
    const result = mergeCatalog(readFileSync(file, 'utf8'), batch, locale);
    writeFileSync(file, result.content, 'utf8');
    written += result.written;
    missing.push(...result.missing);
  }

  if (missing.length) {
    console.error(`\x1b[0;31m✗ ${missing.length} traduction(s) absente(s) du lot :\x1b[0m`);
    for (const m of missing.slice(0, 20)) console.error(`   ${m}`);
    if (missing.length > 20) console.error(`   … et ${missing.length - 20} autres`);
    process.exit(1);
  }

  console.log(
    `\x1b[0;32m✓ ${Object.keys(batch).length} clé(s) écrite(s) dans ${locales.length} catalogues (${written} écritures)\x1b[0m`,
  );
}

// Run directly (and not imported by a test) → launch it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
