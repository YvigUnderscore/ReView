// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Backend error messages: English, and nothing else (D2).
 *
 * They were written in French — a hundred and seventy-four occurrences across seventy
 * files — and reached the screen as they were, including on the public page of a client
 * share. The decision was to rewrite them in English rather than translate them: this check
 * stops French from creeping back in through the next fix.
 *
 * Detection relies on French function words, not on accents: "Media introuvable" carries none
 * and is still French. Conversely, "déjà" in a comment concerns nobody — only the thrown
 * messages are read.
 *
 * Usage: node scripts/check-backend-english.mjs [--list]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = 'backend/src';

/** The functions whose first argument ends up in an HTTP response. */
const THROWING = /\b(badRequest|notFound|forbidden|conflict|unauthorized|tooManyRequests|new Error)\s*\(/;

/**
 * Words that leave no doubt: they do not exist in technical English. One alone is enough to
 * conclude.
 */
const FRENCH_STRONG =
  /\b(introuvable|invalide|réservé|réservée|impossible|déjà|aucun|aucune|inconnu|inconnue|échoué|échouée|volumineux|volumineuse|corbeille|séquence|tâche|fichier|attendu|attendue|requis|requise|vide|trop)\b/i;

/**
 * French function words. On their own they also turn up in technical English — "non-HTTP",
 * "par" in a URL — so **two distinct ones** are needed to conclude. Without this rule, a
 * perfectly correct English message would be flagged.
 */
const FRENCH_WEAK =
  /\b(le|la|les|un|une|des|du|de|au|aux|ce|cet|cette|ces|est|sont|pas|non|pour|avec|sans|sur|dans|par|vers|votre|vos|ne|se|qui|que|encore|doit|doivent|peut|peuvent)\b/gi;

/** What the message contains regardless: accents typical of French. */
const FRENCH_LETTERS = /[àâäçéèêëîïôöùûüœ]/i;

/** The literals passed to a throwing function, line by line. */
export function messagesOf(source) {
  const out = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!THROWING.test(line)) continue;
    // The first literal on the line is the message, the second is the error code.
    const literal = /['`]([^'`]{4,})['`]/.exec(line);
    if (literal) out.push({ line: index + 1, text: literal[1] });
  }
  return out;
}

/** Is this message written in French? */
export function looksFrench(text) {
  const weak = new Set((text.match(FRENCH_WEAK) ?? []).map((w) => w.toLowerCase()));
  return FRENCH_STRONG.test(text) || FRENCH_LETTERS.test(text) || weak.size >= 2;
}

/** French messages of a file — the unit the check reports. */
export function offendersOf(source) {
  return messagesOf(source).filter((m) => looksFrench(m.text));
}

const GREEN = '[0;32m';
const RED = '[0;31m';
const OFF = '[0m';

function main() {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) files.push(full);
    }
  })(ROOT);

  const offenders = [];
  for (const file of files) {
    for (const found of offendersOf(readFileSync(file, 'utf8'))) {
      offenders.push({ file: relative('.', file), ...found });
    }
  }

  if (offenders.length === 0) {
    console.log(`${GREEN}✓ messages d'erreur backend : anglais${OFF}`);
    return;
  }

  if (process.argv.includes('--list')) {
    for (const o of offenders)
      console.log(`  ${o.file}:${o.line}
    ${o.text}`);
  }
  console.log(`${RED}✗ ${offenders.length} message(s) d'erreur en français dans ${ROOT}.${OFF}`);
  console.log('  Relancer avec --list pour les voir, puis les réécrire en anglais.');
  process.exitCode = 1;
}

// Imported by its test: the repository is only walked when this is the command being run.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
