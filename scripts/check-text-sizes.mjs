// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * "No text size in pixels" check (A2).
 *
 * The display density acts on the root font size: everything sized in `rem` follows it, whereas what is
 * written in `px` stays fixed. With 160 `text-[10px]`/`text-[11px]` scattered around, switching to compact
 * flattened the hierarchy instead of tightening it — `text-xs` dropped to 10.9 px while the `text-[10px]`
 * next to it did not move.
 *
 * The scale to use: `text-2xs` (0.625rem), `text-xs`, `text-sm`, `text-base`, `text-lg`… — all backed by
 * the tokens of `index.css`.
 *
 * Line-by-line textual check, like `check-color-tokens.mjs`: the pattern has no reason to exist anywhere
 * but in a utility class. The other arbitrary values (`w-[72px]`, `min-w-[1440px]`) are not concerned:
 * only typography follows the density.
 *
 * Usage: node scripts/check-text-sizes.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = 'frontend/src';

/** `text-[13px]`, `text-[0.8rem]` — any font size written by hand. */
const SIZE_RE = /\btext-\[(\d+(?:\.\d+)?)(px|pt)\]/g;

export function findPixelTextSizes(source) {
  const occurrences = [];
  source.split(/\r?\n/).forEach((text, index) => {
    for (const m of text.matchAll(SIZE_RE)) {
      occurrences.push({ line: index + 1, column: m.index + 1, match: m[0] });
    }
  });
  return occurrences;
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
    for (const occ of findPixelTextSizes(readFileSync(file, 'utf8'))) {
      findings.push({ file: rel, ...occ });
    }
  }

  if (findings.length) {
    console.error(
      `\x1b[0;31m✗ ${findings.length} taille(s) de texte en pixels dans ${ROOT} (la densité ne les atteint pas) :\x1b[0m`,
    );
    for (const f of findings.slice(0, 40)) {
      console.error(`  ${f.file}:${f.line}:${f.column}  ${f.match}`);
    }
    if (findings.length > 40) console.error(`  … et ${findings.length - 40} autre(s)`);
    console.error('  Utiliser la rampe : text-2xs, text-xs, text-sm, text-base, text-lg.');
    process.exit(1);
  }
  console.log('\x1b[0;32m✓ Aucune taille de texte en pixels\x1b[0m');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
