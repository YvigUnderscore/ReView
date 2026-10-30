// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * "Colours = theme tokens" check (project rule): no Tailwind class may carry a hard-coded colour in
 * the frontend. Two families of mistakes:
 *   (a) the raw palette — `bg-blue-500`, `text-amber-400/80` — every named shade short-circuits the
 *       theme and ignores the light/dark mode;
 *   (b) the arbitrary colour — `bg-[#ff0000]`, `text-[rgb(1,2,3)]` — the same mistake, written by
 *       hand. Measured on the repository before being frozen: no legitimate occurrence (neither
 *       generated code nor canvas), so no exclusion to document.
 *
 * Theme tokens (`bg-primary`, `text-muted-foreground`, `bg-destructive/20`, a future
 * `bg-warning`…) and the neutrals outside the palette (`white`, `black`, `transparent`, `current`,
 * `inherit`) remain allowed: they match neither pattern. Arbitrary values that are not colours
 * (`text-[10px]`, `bg-[image:var(--x)]`, `bg-[var(--panel)]`) pass too — only a colour literal is a
 * mistake.
 *
 * The check is textual (line-by-line regex), not a className parser: every literal occurrence of the
 * pattern is reported, even inside a comment or any string — an accepted limit, since the pattern has
 * no reason to exist anywhere but in a utility class. Conversely, a word that merely looks like a class
 * (`sky-blue-500`, `subtext-blue-500`) is not reported: the prefix must be a Tailwind utility at the
 * start of a class.
 *
 * Usage: node scripts/check-color-tokens.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = 'frontend/src';

/** Tailwind utilities that carry a colour. */
export const COLOR_PREFIXES = [
  'bg',
  'text',
  'border',
  'ring',
  'from',
  'to',
  'via',
  'fill',
  'stroke',
  'shadow',
  'outline',
  'decoration',
  'accent',
  'caret',
  'divide',
];

/** Named colours of the Tailwind palette — always replaced by a theme token. */
export const PALETTE_NAMES = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
];

const PREFIX = `(?:${COLOR_PREFIXES.join('|')})`;

// The lookbehind requires the start of a class (`"`, space, variant `:`, `!`): a prefix
// buried in a word (`subtext-blue-500`) or preceded by a dash is not a utility.
const PALETTE_RE = new RegExp(
  `(?<![\\w-])${PREFIX}-(?:${PALETTE_NAMES.join('|')})-\\d{2,3}(?:/\\d{1,3})?(?!\\d)`,
  'g',
);
const ARBITRARY_RE = new RegExp(`(?<![\\w-])${PREFIX}-\\[(?:#|rgb|hsl|oklch)[^\\]]*\\]`, 'g');

/**
 * Reports the colour classes outside tokens in a source.
 * Returns `{ line, column, match, kind }` per occurrence, kind ∈ `palette` | `arbitrary`.
 */
export function findRawColorClasses(source) {
  const occurrences = [];
  source.split(/\r?\n/).forEach((text, index) => {
    for (const [kind, re] of [
      ['palette', PALETTE_RE],
      ['arbitrary', ARBITRARY_RE],
    ]) {
      for (const m of text.matchAll(re)) {
        occurrences.push({ line: index + 1, column: m.index + 1, match: m[0], kind });
      }
    }
  });
  return occurrences.sort((a, b) => a.line - b.line || a.column - b.column);
}

function* sources(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

function main() {
  const findings = [];
  for (const file of sources(path.join(repoRoot, ROOT))) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    for (const occ of findRawColorClasses(readFileSync(file, 'utf8'))) {
      findings.push({ file: rel, ...occ });
    }
  }

  if (findings.length) {
    console.error(
      `\x1b[0;31m✗ ${findings.length} classe(s) de couleur hors tokens du thème dans ${ROOT} :\x1b[0m`,
    );
    for (const f of findings) {
      const label = f.kind === 'palette' ? 'palette brute' : 'couleur arbitraire';
      console.error(`  ${f.file}:${f.line}  ${f.match} (${label})`);
    }
    console.error('  → remplacer par un token du thème (primary, destructive, muted, warning…).');
    process.exit(1);
  }
  console.log('\x1b[0;32m✓ couleurs hors tokens du thème : 0\x1b[0m');
}

// Run directly (and not imported by a test) → launch it.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
