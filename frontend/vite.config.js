// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const I18N_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src/v2/i18n');
const MESSAGES_DIR = path.join(I18N_DIR, 'messages');

/**
 * Locales whose catalogue covers ALL the keys of English, the base language.
 *
 * No catalogue is inlined in the entry chunk (F1): English weighed 51.5 KB gzip, which every
 * non-English reader downloaded before their own language, only to never read a sentence of it.
 * The i18n core only fetches English when it is really needed as a fallback; one still has to know
 * that without having downloaded it, hence this list computed here, from the very files that ship
 * in the bundle.
 *
 * A partial translation remains servable: its language simply leaves the list and English goes back
 * in alongside it. If the read fails, we return an empty list — everyone loads English, as before.
 */
export function localesCoveringBaseCatalog() {
  try {
    const base = JSON.parse(readFileSync(path.join(MESSAGES_DIR, 'en.json'), 'utf8'));
    const baseKeys = Object.keys(base);
    return readdirSync(MESSAGES_DIR)
      .filter((file) => file.endsWith('.json') && file !== 'en.json')
      .filter((file) => {
        const catalog = JSON.parse(readFileSync(path.join(MESSAGES_DIR, file), 'utf8'));
        return baseKeys.every((key) => catalog[key] !== undefined);
      })
      .map((file) => file.slice(0, -'.json'.length));
  } catch {
    return [];
  }
}

/**
 * `localStorage` key where the i18n core stores the chosen language. Must stay equal to
 * `LOCALE_STORAGE_KEY` (`src/v2/i18n/index.ts`) — the preload reads the same slot as the runtime,
 * otherwise it preloads the wrong language. Checked by `preload.test.ts`.
 */
export const LOCALE_STORAGE_KEY = 'locale';

/** Language registry, read at build time: negotiation priority order and base language. */
function localeRegistry() {
  const registry = JSON.parse(readFileSync(path.join(I18N_DIR, 'locales.json'), 'utf8'));
  return { base: registry.base, codes: registry.locales.map((l) => l.code) };
}

/** Identifies a catalogue chunk: `…/src/v2/i18n/messages/<code>.json`, and nothing else. */
const CATALOG_MODULE = /\/src\/v2\/i18n\/messages\/([A-Za-z-]+)\.json$/;

/**
 * Table "language code → chunk file", read from the bundle actually produced.
 *
 * The catalogues are imported through `import.meta.glob`, so their file name is only known at the
 * end of the build — which is precisely why `index.html` could not preload them. We rely neither on
 * the chunk name nor on its order: only the modules it contains count. The Excalidraw catalogue
 * `fr-FR-*.js` has a very similar name and must certainly not be mistaken for ours.
 *
 * @returns {Record<string, string>} table code de langue → chemin servi du chunk.
 */
export function catalogChunkMap(bundle, base = '/') {
  /** @type {Record<string, string>} */
  const map = {};
  for (const entry of Object.values(bundle)) {
    if (entry.type !== 'chunk') continue;
    for (const id of entry.moduleIds ?? []) {
      const found = CATALOG_MODULE.exec(id.replace(/\\/g, '/').split('?')[0]);
      if (found) map[found[1]] = base + entry.fileName;
    }
  }
  return map;
}

/**
 * Source of the catalogue preload script (F13).
 *
 * It replays the negotiation of `negotiateLocale()` — choice saved on the device, otherwise
 * `navigator.languages` — then injects the `<link rel="modulepreload">` of the selected catalogue.
 * Parity with the TypeScript version is checked tag by tag in `preload.test.ts`: this is a deliberate
 * duplication, since no application module can run before the bundle itself.
 *
 * `crossorigin` is mandatory: Vite writes `<script type="module" crossorigin>`, so dynamic imports go
 * out in anonymous CORS mode. A preload without the attribute would be a separate request — the
 * catalogue would be downloaded twice instead of zero times.
 */
export function i18nPreloadSnippet({ map, fullLocales, codes, base, storageKey }) {
  const data = [
    `M=${JSON.stringify(map)}`,
    `C=${JSON.stringify(codes)}`,
    `F=${JSON.stringify(fullLocales)}`,
    `B=${JSON.stringify(base)}`,
    `K=${JSON.stringify(storageKey)}`,
  ].join(',');
  return (
    `(function(){var ${data};` +
    `function pick(list){for(var i=0;i<list.length;i++){var tag=String(list[i]||'').trim();if(!tag)continue;` +
    `var low=tag.toLowerCase();` +
    `for(var j=0;j<C.length;j++)if(C[j].toLowerCase()===low)return C[j];` +
    `if(low==='zh'||low.indexOf('zh-hans')===0||/^zh-(cn|sg|my)$/.test(low))return 'zh-Hans';` +
    `var p=low.split('-')[0];` +
    `for(var k=0;k<C.length;k++)if(C[k].toLowerCase().split('-')[0]===p)return C[k];}` +
    `return B;}` +
    `var code=null;try{var s=localStorage.getItem(K);if(C.indexOf(s)>=0)code=s;}catch(e){}` +
    // Share link: English straight away, without negotiating — same rule as `isSharePath`
    // in the i18n core. The two must agree, otherwise the document preloads one
    // language and the bundle downloads another (parity held by `preload.test.ts`).
    `if(!code&&location.pathname.indexOf('/client/')>=0)code=B;` +
    `if(!code){var L=navigator.languages;code=pick(L?L:[navigator.language]);}` +
    `function pre(href){if(!href)return;var l=document.createElement('link');` +
    `l.rel='modulepreload';l.crossOrigin='anonymous';l.href=href;document.head.appendChild(l);}` +
    `pre(M[code]);if(code!==B&&F.indexOf(code)<0)pre(M[B]);})();`
  );
}

/**
 * Inserts the preload script into `<head>`, **before** the entry module.
 *
 * The order is not cosmetic: deferred scripts and modules execute in document order. Placed after
 * the entry — which is what we measured — the script only ran once the 122 KB bundle had been
 * downloaded AND evaluated, and the catalogue request left at the same moment as before the fix:
 * zero gain. Placed before, it runs as soon as it arrives (1.1 KB), while the bundle is still in
 * flight.
 *
 * A **classic** script, not a module: `scripts/check-bundle-budget.mjs` identifies the entry by the
 * first `type="module"` tag, and a module placed here would make it measure this file — a few hundred
 * bytes — instead of the real first load.
 */
export function injectPreloadScript(html, href) {
  const tag = `<script defer src="${href}"></script>`;
  const entry = html.search(/<script[^>]+type="module"/);
  // Fallback to the end of the head if Vite changes how it injects the entry: the
  // preload loses its head start, but the document stays valid.
  if (entry < 0) return html.replace('</head>', `  ${tag}\n  </head>`);
  return `${html.slice(0, entry)}${tag}\n    ${html.slice(entry)}`;
}

/**
 * Preloads the language catalogue as soon as the document is parsed (F13).
 *
 * Without it, the catalogue request only leaves once the entry chunk has been downloaded, parsed
 * and executed — and the first render waits for it. Measured at 80 ms latency: the French catalogue
 * started at t+197 ms where the bundle started at t+96 ms, i.e. a fully serialised round trip behind
 * 414 KB of JavaScript.
 *
 * The document cannot guess the language: it comes from `localStorage` then `navigator.languages`,
 * two sources only JavaScript can reach. The auditor proposed an **inline** script with a CSP nonce;
 * the production CSP (`script-src 'self'`) has neither `unsafe-inline` nor a nonce on this page, and
 * reopening it would undo the security batch. An external file of a few hundred bytes goes through
 * `'self'` without touching the CSP: its round trip overlaps with the bundle's, which is a hundred
 * times bigger.
 */
function i18nCatalogPreload() {
  let base = '/';
  let assetsDir = 'assets';
  return {
    name: 'review:i18n-catalog-preload',
    enforce: 'post',
    apply: 'build',
    configResolved(config) {
      base = config.base;
      assetsDir = config.build.assetsDir;
    },
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset' || typeof html.source !== 'string') return;
      const map = catalogChunkMap(bundle, base);
      // No catalogue found: leave the document alone rather than adding a script that
      // would preload nothing.
      if (Object.keys(map).length === 0) return;
      const { base: baseLocale, codes } = localeRegistry();
      const source = i18nPreloadSnippet({
        map,
        fullLocales: localesCoveringBaseCatalog(),
        codes,
        base: baseLocale,
        storageKey: LOCALE_STORAGE_KEY,
      });
      // Hashed name like the other assets: the content changes with the catalogue
      // fingerprints, and nginx serves `/assets/` as `immutable`.
      const hash = createHash('sha256').update(source).digest('base64url').slice(0, 8);
      const fileName = `${assetsDir}/i18n-preload-${hash}.js`;
      this.emitFile({ type: 'asset', fileName, source });
      html.source = injectPreloadScript(html.source, base + fileName);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), i18nCatalogPreload()],
  // `@/…` = `src/…` (same mapping in tsconfig `paths` and vitest.config.ts).
  resolve: { alias: { '@': path.join(path.dirname(fileURLToPath(import.meta.url)), 'src') } },
  define: {
    // Read by `src/v2/i18n/index.ts`. A string literal rather than an array: the
    // replacement is textual, and a comma is shorter than a JSON array.
    'import.meta.env.I18N_FULL_LOCALES': JSON.stringify(localesCoveringBaseCatalog().join(',')),
  },
  // Keep the dependencies' licence banners in the bundle shipped to the browser: MIT, BSD and ISC
  // require their notice to accompany any redistribution, yet esbuild strips them by default during
  // minification. The full attribution remains in THIRD-PARTY-NOTICES.md; this ensures it also travels
  // with the code served.
  esbuild: {
    legalComments: 'inline',
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * Application core in its own file (D3): React, the router, the data layer. The slightest fix
         * used to invalidate everything, and the browser re-downloaded these unchanged libraries on
         * every deployment.
         *
         * ONLY what is loaded at startup anyway is grouped. Naming a chunk for three, Spark or
         * Excalidraw would pull them up into static imports of the entry point — they are loaded on
         * demand, and would remain so on paper while being downloaded straight away.
         */
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('react-router')) {
            return 'vendor-react';
          }
          if (id.includes('@tanstack') || id.includes('zustand') || id.includes('socket.io-client')) {
            return 'vendor-data';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    // Loopback by default: the dev server must not be offered to the whole network. Docker
    // (or a LAN demo) sets VITE_DEV_HOST=0.0.0.0.
    host: process.env.VITE_DEV_HOST || '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
  preview: {
    proxy: {
      // Preview tested against the containerised backend (host port 3430)
      '/api': {
        target: 'http://localhost:3430',
        changeOrigin: true,
      },
      // Without it, no real-time event (presence, hls:changed, markers…) reaches the preview.
      '/socket.io': {
        target: 'ws://localhost:3430',
        ws: true,
      },
    },
  },
});
