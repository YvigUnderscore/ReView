// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Budget de poids du bundle d'entrée (A2).
 *
 * Le chunk chargé avant le premier écran pèse aujourd'hui ~711 Ko compressés : il embarque
 * l'espace de review et les onglets d'administration, payés même sur la page de connexion.
 * Le découpage par route est prévu en D3 ; d'ici là ce contrôle empêche la situation
 * d'empirer, et le plafond descendra à mesure que le découpage avance.
 *
 * Mesure la taille **gzip** du script d'entrée référencé par `dist/index.html` — c'est ce
 * que le navigateur télécharge réellement.
 *
 * Usage : node scripts/check-bundle-budget.mjs [--set=<octets>]
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(repoRoot, 'frontend/dist');

/**
 * Plafond du chunk d'entrée, en octets gzip. Constaté à 711 ko le 2026-08-17 ; la marge
 * absorbe les variations de minification sans laisser passer une vraie régression.
 */
export const ENTRY_BUDGET_GZIP = 730_000;

/** Chemin du script d'entrée déclaré dans index.html (`<script type="module" src=…>`). */
export function entryScriptFrom(html) {
  const match = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html);
  return match ? match[1].replace(/^\//, '') : null;
}

function main() {
  const indexHtml = path.join(DIST, 'index.html');
  if (!existsSync(indexHtml)) {
    console.error("\x1b[0;31m✗ frontend/dist/index.html absent : lancer le build d'abord\x1b[0m");
    process.exit(1);
  }
  const entry = entryScriptFrom(readFileSync(indexHtml, 'utf8'));
  if (!entry) {
    console.error("\x1b[0;31m✗ script d'entrée introuvable dans dist/index.html\x1b[0m");
    process.exit(1);
  }
  const size = gzipSync(readFileSync(path.join(DIST, entry))).length;
  const kb = (n) => `${(n / 1000).toFixed(1)} ko`;
  if (size > ENTRY_BUDGET_GZIP) {
    console.error(
      `\x1b[0;31m✗ Bundle d'entrée ${kb(size)} gzip > budget ${kb(ENTRY_BUDGET_GZIP)} (${entry})\x1b[0m`,
    );
    console.error("  Découper par route (React.lazy) ou charger la dépendance à l'usage.");
    process.exit(1);
  }
  console.log(`\x1b[0;32m✓ Bundle d'entrée ${kb(size)} gzip (budget ${kb(ENTRY_BUDGET_GZIP)})\x1b[0m`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
