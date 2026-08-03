// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ajoute un lot de clés aux quatorze catalogues d'un coup.
 *
 * Une clé n'existe que si elle est présente dans les quatorze langues : quatorze éditions
 * à la main, c'est quatorze occasions d'en oublier une — et la clé oubliée ne se voit qu'à
 * l'écran, dans la langue que personne ne relit. Ce script prend le lot une fois et l'écrit
 * partout.
 *
 * Usage :
 *   node scripts/i18n-add.mjs <lot.json> [--set=frontend|backend]
 *
 * Format du lot — une entrée par clé, une entrée par langue, valeur simple ou formes
 * plurielles :
 *   {
 *     "admin.title": { "en": "Administration", "fr": "Administration", "ja": "管理", … },
 *     "admin.count": { "en": { "one": "{count} item", "other": "{count} items" }, … }
 *   }
 *
 * La clé est insérée à la suite des clés de même préfixe pour que les catalogues restent
 * lisibles ; une clé déjà présente est mise à jour sur place. Le contrôle de cohérence
 * (`check-translations.mjs`) reste l'autorité : ce script écrit, il ne valide pas.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SETS = {
  frontend: 'frontend/src/v2/i18n/messages',
  backend: 'backend/src/i18n/messages',
};

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

/** Rend la valeur telle qu'elle s'écrit dans le catalogue — une clé par ligne, style Prettier. */
const render = (key, value) => {
  const body =
    typeof value === 'string'
      ? JSON.stringify(value)
      : `{ ${Object.entries(value)
          .map(([form, text]) => `${JSON.stringify(form)}: ${JSON.stringify(text)}`)
          .join(', ')} }`;
  return `  ${JSON.stringify(key)}: ${body},`;
};

let written = 0;
const missing = [];

for (const locale of locales) {
  const file = join(dir, `${locale}.json`);
  const raw = readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);

  for (const [key, byLocale] of Object.entries(batch)) {
    const value = byLocale[locale];
    if (value === undefined) {
      missing.push(`${locale} ← ${key}`);
      continue;
    }
    const line = render(key, value);
    const existing = lines.findIndex((l) => l.startsWith(`  ${JSON.stringify(key)}:`));
    if (existing >= 0) {
      // La dernière entrée du fichier n'a pas de virgule : ne pas lui en donner une.
      lines[existing] = lines[existing].trimEnd().endsWith(',') ? line : line.slice(0, -1);
      written += 1;
      continue;
    }
    // À la suite des clés de même préfixe, sinon en fin de catalogue.
    const prefix = `  "${key.split('.')[0]}.`;
    let at = -1;
    lines.forEach((l, i) => {
      if (l.startsWith(prefix)) at = i;
    });
    if (at < 0) {
      // En fin de fichier : l'ancienne dernière entrée prend sa virgule, la nouvelle non.
      at = lines.reduce((acc, l, i) => (l.startsWith('  "') || l.trim() === '},' ? i : acc), -1);
      lines[at] = `${lines[at].trimEnd().replace(/,$/, '')},`;
      lines.splice(at + 1, 0, line.slice(0, -1));
    } else {
      lines.splice(at + 1, 0, lines[at].trimEnd().endsWith(',') ? line : line.slice(0, -1));
      if (!lines[at].trimEnd().endsWith(',')) lines[at] = `${lines[at].trimEnd()},`;
    }
    written += 1;
  }

  writeFileSync(file, lines.join(eol), 'utf8');
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
