// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * First-load weight budget (A2, corrected in D3, extended in F-lot8).
 *
 * Measures the **gzip** size of everything the browser downloads before the first screen: the
 * entry script, the modules it preloads (`modulepreload`) **and** the stylesheet linked from
 * `index.html`.
 *
 * Counting only the entry file would be misleading since the split into chunks: moving React
 * into a separate file would make the measure "drop" without anything changing for the reader,
 * who downloads both before seeing anything.
 *
 * Same reasoning for CSS, long forgotten in the count: `<link rel="stylesheet">` **blocks
 * rendering**. The page stays blank until it has arrived, exactly as for an entry script. Excluding
 * it made the check announce "427 KB" where nginx served 442 KB — a safeguard that measured beside
 * what it claimed to protect.
 *
 * Usage: node scripts/check-bundle-budget.mjs
 */

import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(repoRoot, 'frontend/dist');

/**
 * First-load ceiling, in gzip bytes. Set at 430 KB after the per-route split (D3), which had brought
 * the scripts down from 724 to 401 KB. The margin absorbs minification variations without letting a
 * real regression through.
 *
 * **It was not raised** when the stylesheet entered the count: the real first load then weighed
 * 441.6 KB and the check failed, which was the exact state of the repository. Raising the ceiling to
 * silence the measure would have repeated the mistake we had just corrected.
 *
 * 2026-09-16: 430 -> 280 KB. The measured first load fell to **258.6 KB gzip across four files,
 * stylesheet included** — English catalogue moved out of the entry chunk, ProjectPage and its twelve
 * tabs loaded on demand, client share page split off, framer-motion, @dnd-kit, marked and hash-wasm
 * taken out of the first load. The ceiling is lowered to the figure actually reached when we go down —
 * never the other way round. The 21 KB margin absorbs minification variations, not a regression.
 */
export const ENTRY_BUDGET_GZIP = 280_000;

/** Path of the entry script declared in index.html (`<script type="module" src=…>`). */
export function entryScriptFrom(html) {
  const match = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html);
  return match ? match[1].replace(/^\//, '') : null;
}

/**
 * `href` of the `<link>` tags carrying the requested `rel`, whatever the order of the
 * attributes: Vite writes `rel` before `href`, but nothing guarantees it, and a safeguard that
 * depends on a generator's attribute order ends up silently measuring zero.
 */
function linkHrefs(html, rel) {
  const wanted = new RegExp(`\\brel=["']${rel}["']`);
  const out = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    if (!wanted.test(tag)) continue;
    // A single leading slash is stripped (absolute site path); `//cdn/…` stays
    // an external URL, which we want to be able to recognise as such further down.
    const href = /\bhref=["']([^"']+)["']/.exec(tag);
    if (href) out.push(href[1].replace(/^\/(?!\/)/, ''));
  }
  return out;
}

/**
 * Scripts the page loads straight away: the entry and its `modulepreload`s. Vite emits one per
 * static import of the entry point — these are exactly the files the browser fetches before
 * running anything.
 */
export function preloadedScriptsFrom(html) {
  const out = [];
  const entry = entryScriptFrom(html);
  if (entry) out.push(entry);
  out.push(...linkHrefs(html, 'modulepreload'));
  return [...new Set(out)];
}

/** Stylesheets linked from `index.html`: they block the rendering of the first screen. */
export function stylesheetsFrom(html) {
  return [...new Set(linkHrefs(html, 'stylesheet'))];
}

/** Everything the page loads straight away: entry scripts, preloads and styles. */
export function firstLoadAssetsFrom(html) {
  return [...new Set([...preloadedScriptsFrom(html), ...stylesheetsFrom(html)])];
}

/** A resource outside the `dist` folder (CDN, data:): it cannot be weighed here. */
const isExternal = (href) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href);

/**
 * Weighs the first load of a `dist` folder: returns the list of measured files, the gzip total,
 * and the external resources that could not be weighed (to report them rather than hide them — this
 * is precisely the oversight we correct here).
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
