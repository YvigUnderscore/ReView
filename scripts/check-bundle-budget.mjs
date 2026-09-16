// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Budget de poids du premier chargement (A2, corrigé en D3, complété en F-lot8).
 *
 * Mesure la taille **gzip** de tout ce que le navigateur télécharge avant le premier
 * écran : le script d'entrée, les modules qu'il précharge (`modulepreload`) **et** la
 * feuille de style liée depuis `index.html`.
 *
 * Ne compter que le fichier d'entrée serait trompeur depuis le découpage en chunks : sortir
 * React dans un fichier séparé ferait « baisser » la mesure sans que rien n'ait changé pour
 * le lecteur, qui télécharge les deux avant de voir quoi que ce soit.
 *
 * Même raisonnement pour la CSS, longtemps oubliée du décompte : `<link rel="stylesheet">`
 * **bloque le rendu**. La page reste blanche tant qu'elle n'est pas arrivée, exactement
 * comme pour un script d'entrée. L'exclure faisait annoncer « 427 ko » là où nginx servait
 * 442 ko — un garde-fou qui mesurait à côté de ce qu'il prétendait protéger.
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
 * Plafond du premier chargement, en octets gzip. Posé à 430 ko après le découpage par
 * route (D3), qui avait ramené les scripts de 724 à 401 ko. La marge absorbe les
 * variations de minification sans laisser passer une vraie régression.
 *
 * **Il n'a pas été relevé** quand la feuille de style est entrée dans le décompte : le premier
 * chargement réel pesait alors 441,6 ko et le contrôle échouait, ce qui était l'état exact du
 * dépôt. Relever le plafond pour faire taire la mesure aurait refait l'erreur qu'on venait de
 * corriger.
 *
 * 2026-09-16 : 430 -> 280 ko. Le premier chargement mesuré est tombé à **258,6 ko gzip sur
 * quatre fichiers, feuille de style comprise** — catalogue anglais sorti du chunk d'entrée,
 * ProjectPage et ses douze onglets chargés à la demande, page de partage client détachée,
 * framer-motion, @dnd-kit, marked et hash-wasm sortis du premier chargement. Le plafond se
 * baisse au chiffre réellement atteint quand on descend — jamais l'inverse. La marge de 21 ko
 * absorbe les variations de minification, pas une régression.
 */
export const ENTRY_BUDGET_GZIP = 280_000;

/** Chemin du script d'entrée déclaré dans index.html (`<script type="module" src=…>`). */
export function entryScriptFrom(html) {
  const match = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html);
  return match ? match[1].replace(/^\//, '') : null;
}

/**
 * `href` des balises `<link>` portant le `rel` demandé, quel que soit l'ordre des
 * attributs : Vite écrit `rel` avant `href`, mais rien ne le garantit et un garde-fou qui
 * dépend de l'ordre d'attributs d'un générateur finit par mesurer zéro sans le dire.
 */
function linkHrefs(html, rel) {
  const wanted = new RegExp(`\\brel=["']${rel}["']`);
  const out = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    if (!wanted.test(tag)) continue;
    // Une seule barre initiale est retirée (chemin absolu du site) ; `//cdn/…` reste
    // une URL externe, qu'on veut pouvoir reconnaître comme telle plus bas.
    const href = /\bhref=["']([^"']+)["']/.exec(tag);
    if (href) out.push(href[1].replace(/^\/(?!\/)/, ''));
  }
  return out;
}

/**
 * Scripts que la page charge d'emblée : l'entrée et ses `modulepreload`. Vite en émet un
 * par import statique du point d'entrée — ce sont exactement les fichiers que le
 * navigateur va chercher avant d'exécuter quoi que ce soit.
 */
export function preloadedScriptsFrom(html) {
  const out = [];
  const entry = entryScriptFrom(html);
  if (entry) out.push(entry);
  out.push(...linkHrefs(html, 'modulepreload'));
  return [...new Set(out)];
}

/** Feuilles de style liées depuis `index.html` : elles bloquent le rendu du premier écran. */
export function stylesheetsFrom(html) {
  return [...new Set(linkHrefs(html, 'stylesheet'))];
}

/** Tout ce que la page charge d'emblée : scripts d'entrée, préchargements et styles. */
export function firstLoadAssetsFrom(html) {
  return [...new Set([...preloadedScriptsFrom(html), ...stylesheetsFrom(html)])];
}

/** Une ressource hors du dossier `dist` (CDN, data:) : on ne peut pas la peser ici. */
const isExternal = (href) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href);

/**
 * Pèse le premier chargement d'un dossier `dist` : rend la liste des fichiers mesurés, le
 * total gzip, et les ressources externes qu'on n'a pas pu peser (pour les dire plutôt que
 * de les escamoter — c'est précisément l'oubli qu'on corrige ici).
 */
export function measureFirstLoad(distDir) {
  const html = readFileSync(path.join(distDir, 'index.html'), 'utf8');
  const assets = firstLoadAssetsFrom(html);
  const external = assets.filter(isExternal);
  const files = assets.filter((href) => !isExternal(href));
  const bytes = files.reduce((n, f) => n + gzipSync(readFileSync(path.join(distDir, f))).length, 0);
  return { files, bytes, external };
}

function main() {
  const indexHtml = path.join(DIST, 'index.html');
  if (!existsSync(indexHtml)) {
    console.error("\x1b[0;31m✗ frontend/dist/index.html absent : lancer le build d'abord\x1b[0m");
    process.exit(1);
  }
  const { files, bytes, external } = measureFirstLoad(DIST);
  if (files.length === 0) {
    console.error("\x1b[0;31m✗ script d'entrée introuvable dans dist/index.html\x1b[0m");
    process.exit(1);
  }
  for (const href of external) {
    console.error(`\x1b[0;33m! ressource externe non pesée : ${href}\x1b[0m`);
  }
  const kb = (n) => `${(n / 1000).toFixed(1)} ko`;
  if (bytes > ENTRY_BUDGET_GZIP) {
    console.error(
      `\x1b[0;31m✗ Premier chargement ${kb(bytes)} gzip > budget ${kb(ENTRY_BUDGET_GZIP)}` +
        ` (${files.length} fichier(s), styles compris)\x1b[0m`,
    );
    console.error("  Découper par route (React.lazy) ou charger la dépendance à l'usage.");
    process.exit(1);
  }
  console.log(
    `\x1b[0;32m✓ Premier chargement ${kb(bytes)} gzip, ${files.length} fichier(s) styles compris` +
      ` (budget ${kb(ENTRY_BUDGET_GZIP)})\x1b[0m`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
