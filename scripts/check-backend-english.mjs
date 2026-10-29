// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Backend error and log messages: English, and nothing else (D2).
 *
 * They were written in French — a hundred and seventy-four occurrences across seventy
 * files — and reached the screen as they were, including on the public page of a client
 * share. The decision was to rewrite them in English rather than translate them: this check
 * stops French from creeping back in through the next fix.
 *
 * Detection relies on French function words, not on accents: "Media introuvable" carries none
 * and is still French. Conversely, "déjà" in a comment concerns nobody — only the thrown
 * messages and the log messages are read.
 *
 * Out of scope: the user-facing texts that are localized on purpose (emails, notifications, the
 * ShotGrid journal). They do not live in the source but in the `src/i18n/messages/*.json` catalogs,
 * reached through `t(key)`: a catalog key is an identifier, not a sentence, and passes this check.
 *
 * Usage: node scripts/check-backend-english.mjs [--list]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Resolved from the script, so the check runs from any working directory. */
const ROOT = resolve(fileURLToPath(import.meta.url), '../../backend/src');

/**
 * Calls whose string arguments a human reads: the error factories and the JSON bodies written by hand
 * (`res.status(403).json({ error: … })`) end up in an HTTP response, the logger in front of whoever
 * operates the server. The logger form covers `logger.warn(…)`, `req.log.error(…)` and the child
 * loggers named `log`.
 */
const CALLS =
  /(?:\b(?:badRequest|notFound|forbidden|conflict|unauthorized|tooManyRequests|new \w*Error|(?:logger|log)\.(?:fatal|error|warn|info|debug|trace))|\.json)\s*\(/g;

/** An error code (`'BAD_NAME'`), not a sentence: never French, never read as one. */
const ERROR_CODE = /^[A-Z][A-Z0-9_.]*$/;

/**
 * The string literals passed to a call that starts at `open` (the index of its `(`), up to the matching
 * `)`. Reads across lines — a message wrapped by Prettier onto the next line is still the message — and
 * through template literals, whose `${…}` parts are replaced by a space. Quotes inside a literal (the
 * apostrophe of "l'objet") do not end it: the scanner knows the delimiter it opened.
 */
function literalsOfCall(source, open) {
  const out = [];
  let depth = 0;
  let i = open;
  while (i < source.length) {
    const c = source[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) break;
    } else if (c === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i);
      if (i < 0) break;
      continue;
    } else if (c === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i + 2);
      if (i < 0) break;
      i += 2;
      continue;
    } else if (c === "'" || c === '"' || c === '`') {
      const begin = i;
      const { text, end } = readLiteral(source, i);
      out.push({ index: begin, text });
      i = end + 1;
      continue;
    }
    i++;
  }
  return out;
}

/** Reads the literal opened at `start`; returns its text (interpolations blanked) and closing index. */
function readLiteral(source, start) {
  const quote = source[start];
  let text = '';
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      text += source[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (c === quote) return { text, end: i };
    if (quote === '`' && c === '$' && source[i + 1] === '{') {
      // Skip the interpolation, nested braces and strings included.
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        const d = source[i];
        if (d === "'" || d === '"' || d === '`') {
          i = readLiteral(source, i).end + 1;
          continue;
        }
        if (d === '{') depth++;
        else if (d === '}') depth--;
        i++;
      }
      text += ' ';
      continue;
    }
    if (quote !== '`' && c === '\n') return { text, end: i };
    text += c;
    i++;
  }
  return { text, end: i };
}

/** Line (1-based) of an index in the source. */
function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** The human-read literals of a source: arguments of the error factories and of the logger. */
export function messagesOf(source) {
  const out = [];
  for (const match of source.matchAll(CALLS)) {
    const open = match.index + match[0].length - 1;
    for (const literal of literalsOfCall(source, open)) {
      const text = literal.text.trim();
      if (text.length < 4 || ERROR_CODE.test(text)) continue;
      out.push({ line: lineAt(source, literal.index), text });
    }
  }
  return out;
}

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
