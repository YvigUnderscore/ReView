// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Contrôle « pas de taille de texte en pixels » (A2).
 *
 * La densité d'affichage agit sur la taille de police racine : tout ce qui est dimensionné
 * en `rem` la suit, ce qui est écrit en `px` reste figé. Avec 160 `text-[10px]`/`text-[11px]`
 * disséminés, passer en compact aplatissait la hiérarchie au lieu de la resserrer — le
 * `text-xs` descendait à 10,9 px pendant que le `text-[10px]` d'à côté ne bougeait pas.
 *
 * La rampe à utiliser : `text-2xs` (0.625rem), `text-xs`, `text-sm`, `text-base`, `text-lg`…
 * — tous adossés aux tokens de `index.css`.
 *
 * Contrôle textuel ligne à ligne, comme `check-color-tokens.mjs` : le motif n'a aucune
 * raison d'exister ailleurs que dans une classe utilitaire. Les autres valeurs arbitraires
 * (`w-[72px]`, `min-w-[1440px]`) ne sont pas concernées : seule la typographie suit la
 * densité.
 *
 * Usage : node scripts/check-text-sizes.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = 'frontend/src';

/** `text-[13px]`, `text-[0.8rem]` — toute taille de police écrite à la main. */
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
