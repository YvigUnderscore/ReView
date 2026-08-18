// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Budget de poids du premier chargement (A2, corrigé en D3).
 *
 * Mesure la taille **gzip** de tout ce que le navigateur télécharge avant le premier
 * écran : le script d'entrée **et** les modules qu'il précharge (`modulepreload`), c'est-
 * à-dire ses imports statiques.
 *
 * Ne compter que le fichier d'entrée serait trompeur depuis le découpage en chunks : sortir
 * React dans un fichier séparé ferait « baisser » la mesure sans que rien n'ait changé pour
 * le lecteur, qui télécharge les deux avant de voir quoi que ce soit.
 *
 * Usage : node scripts/check-bundle-budget.mjs
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(repoRoot, 'frontend/dist');

/**
 * Plafond du premier chargement, en octets gzip. Constaté à 401 ko après le découpage par
 * route (D3), contre 724 ko auparavant. La marge absorbe les variations de minification
 * sans laisser passer une vraie régression. Le baisser quand on descend, jamais l'inverse.
 */
export const ENTRY_BUDGET_GZIP = 430_000;

/** Chemin du script d'entrée déclaré dans index.html (`<script type="module" src=…>`). */
export function entryScriptFrom(html) {
  const match = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html);
  return match ? match[1].replace(/^\//, '') : null;
}

/**
 * Tout ce que la page charge d'emblée : l'entrée et ses `modulepreload`. Vite en émet un
 * par import statique du point d'entrée — ce sont exactement les fichiers que le
 * navigateur va chercher avant d'exécuter quoi que ce soit.
 */
export function preloadedScriptsFrom(html) {
  const out = [];
  const entry = entryScriptFrom(html);
  if (entry) out.push(entry);
  for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) {
    out.push(m[1].replace(/^\//, ''));
  }
  return [...new Set(out)];
}

function main() {
  const indexHtml = path.join(DIST, 'index.html');
  if (!existsSync(indexHtml)) {
    console.error("\x1b[0;31m✗ frontend/dist/index.html absent : lancer le build d'abord\x1b[0m");
    process.exit(1);
  }
  const scripts = preloadedScriptsFrom(readFileSync(indexHtml, 'utf8'));
  if (scripts.length === 0) {
    console.error("\x1b[0;31m✗ script d'entrée introuvable dans dist/index.html\x1b[0m");
    process.exit(1);
  }
  const size = scripts.reduce((n, f) => n + gzipSync(readFileSync(path.join(DIST, f))).length, 0);
  const kb = (n) => `${(n / 1000).toFixed(1)} ko`;
  if (size > ENTRY_BUDGET_GZIP) {
    console.error(
      `\x1b[0;31m✗ Premier chargement ${kb(size)} gzip > budget ${kb(ENTRY_BUDGET_GZIP)}` +
        ` (${scripts.length} fichier(s))\x1b[0m`,
    );
    console.error("  Découper par route (React.lazy) ou charger la dépendance à l'usage.");
    process.exit(1);
  }
  console.log(
    `\x1b[0;32m✓ Premier chargement ${kb(size)} gzip, ${scripts.length} fichier(s)` +
      ` (budget ${kb(ENTRY_BUDGET_GZIP)})\x1b[0m`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
