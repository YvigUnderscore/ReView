// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Contrôle « couleurs = tokens du thème » (règle projet) : aucune classe Tailwind ne doit
 * porter une couleur en dur dans le frontend. Deux familles de fautes :
 *   (a) la palette brute — `bg-blue-500`, `text-amber-400/80` — chaque nuance nommée
 *       court-circuite le thème et ignore le mode clair/sombre ;
 *   (b) la couleur arbitraire — `bg-[#ff0000]`, `text-[rgb(1,2,3)]` — même faute, écrite
 *       à la main. Mesuré sur le dépôt avant d'être figé : aucune occurrence légitime
 *       (ni code généré, ni canvas), donc aucune exclusion à documenter.
 *
 * Les tokens du thème (`bg-primary`, `text-muted-foreground`, `bg-destructive/20`, un
 * futur `bg-warning`…) et les neutres hors palette (`white`, `black`, `transparent`,
 * `current`, `inherit`) restent permis : ils ne correspondent à aucun des deux motifs.
 * Les valeurs arbitraires non colorées (`text-[10px]`, `bg-[image:var(--x)]`,
 * `bg-[var(--panel)]`) passent aussi — seul un littéral de couleur est une faute.
 *
 * Le contrôle est textuel (regex ligne à ligne), pas un parseur de className : toute
 * occurrence littérale du motif est signalée, même dans un commentaire ou une chaîne
 * quelconque — limite assumée, le motif n'a aucune raison d'exister ailleurs que dans
 * une classe utilitaire. Inversement, un mot qui ne fait que ressembler à une classe
 * (`sky-blue-500`, `subtext-blue-500`) n'est pas signalé : le préfixe doit être un
 * utilitaire Tailwind en tête de classe.
 *
 * Usage : node scripts/check-color-tokens.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = 'frontend/src';

/** Utilitaires Tailwind porteurs de couleur. */
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

/** Couleurs nommées de la palette Tailwind — toujours remplacées par un token du thème. */
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

// Le lookbehind exige un début de classe (`"`, espace, `:` de variante, `!`) : un préfixe
// enfoui dans un mot (`subtext-blue-500`) ou précédé d'un tiret n'est pas un utilitaire.
const PALETTE_RE = new RegExp(
  `(?<![\\w-])${PREFIX}-(?:${PALETTE_NAMES.join('|')})-\\d{2,3}(?:/\\d{1,3})?(?!\\d)`,
  'g',
);
const ARBITRARY_RE = new RegExp(`(?<![\\w-])${PREFIX}-\\[(?:#|rgb|hsl|oklch)[^\\]]*\\]`, 'g');

/**
 * Relève les classes de couleur hors tokens dans un source.
 * Rend `{ line, column, match, kind }` par occurrence, kind ∈ `palette` | `arbitrary`.
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

// Exécuté directement (et non importé par un test) → on lance.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
