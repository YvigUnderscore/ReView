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
 * Langues dont le catalogue couvre TOUTES les clés de l'anglais, langue de base.
 *
 * Aucun catalogue n'est inliné dans le chunk d'entrée (F1) : l'anglais y pesait 51,5 ko
 * gzip que tout lecteur non anglophone téléchargeait avant sa propre langue, pour ne
 * jamais en lire une phrase. Le socle i18n ne va chercher l'anglais que lorsqu'il sert
 * réellement de repli ; encore faut-il le savoir sans l'avoir téléchargé, d'où cette
 * liste calculée ici, sur les fichiers-mêmes qui partent dans le bundle.
 *
 * Une traduction partielle reste servable : sa langue sort simplement de la liste et
 * l'anglais repart avec elle, en parallèle. La lecture échoue-t-elle ? On rend une liste
 * vide — tout le monde charge l'anglais, comme avant.
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
 * Clé de `localStorage` où le socle i18n range la langue choisie. Doit rester égale à
 * `LOCALE_STORAGE_KEY` (`src/v2/i18n/index.ts`) — le préchargement lit la même case que
 * le runtime, sinon il précharge la mauvaise langue. Vérifié par `preload.test.ts`.
 */
export const LOCALE_STORAGE_KEY = 'locale';

/** Registre des langues, lu au build : ordre de priorité de la négociation et langue de base. */
function localeRegistry() {
  const registry = JSON.parse(readFileSync(path.join(I18N_DIR, 'locales.json'), 'utf8'));
  return { base: registry.base, codes: registry.locales.map((l) => l.code) };
}

/** Repère un chunk de catalogue : `…/src/v2/i18n/messages/<code>.json`, et rien d'autre. */
const CATALOG_MODULE = /\/src\/v2\/i18n\/messages\/([A-Za-z-]+)\.json$/;

/**
 * Table « code de langue → fichier du chunk », relevée sur le bundle réellement produit.
 *
 * Les catalogues sont importés par `import.meta.glob`, donc leur nom de fichier n'est connu
 * qu'à la fin du build — c'est précisément pourquoi `index.html` ne pouvait pas les
 * précharger. On ne se fie ni au nom du chunk ni à son ordre : seuls comptent les modules
 * qu'il contient. Le catalogue Excalidraw `fr-FR-*.js` porte un nom très ressemblant et ne
 * doit surtout pas être pris pour le nôtre.
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
 * Source du script de préchargement des catalogues (F13).
 *
 * Il rejoue la négociation de `negotiateLocale()` — choix enregistré sur l'appareil, sinon
 * `navigator.languages` — puis injecte le `<link rel="modulepreload">` du catalogue retenu.
 * La parité avec la version TypeScript est vérifiée tag par tag dans `preload.test.ts` :
 * c'est une duplication assumée, aucun module applicatif ne pouvant être exécuté avant le
 * bundle lui-même.
 *
 * `crossorigin` est obligatoire : Vite écrit `<script type="module" crossorigin>`, donc les
 * imports dynamiques partent en mode CORS anonyme. Une précharge sans l'attribut serait une
 * requête distincte — le catalogue serait téléchargé deux fois au lieu de zéro.
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
    `if(!code){var L=navigator.languages;code=pick(L?L:[navigator.language]);}` +
    `function pre(href){if(!href)return;var l=document.createElement('link');` +
    `l.rel='modulepreload';l.crossOrigin='anonymous';l.href=href;document.head.appendChild(l);}` +
    `pre(M[code]);if(code!==B&&F.indexOf(code)<0)pre(M[B]);})();`
  );
}

/**
 * Insère le script de préchargement dans `<head>`, **avant** le module d'entrée.
 *
 * L'ordre n'est pas cosmétique : scripts différés et modules s'exécutent dans l'ordre du
 * document. Posé après l'entrée — ce qu'on a mesuré — le script n'était exécuté qu'une fois
 * les 122 ko du bundle téléchargés ET évalués, et la requête du catalogue repartait au même
 * instant qu'avant le correctif : zéro gain. Posé avant, il s'exécute dès son arrivée
 * (1,1 ko), pendant que le bundle est encore en vol.
 *
 * Script **classique** et non module : `scripts/check-bundle-budget.mjs` identifie l'entrée
 * par la première balise `type="module"`, et un module placé ici lui ferait mesurer ce
 * fichier-ci — quelques centaines d'octets — au lieu du vrai premier chargement.
 */
export function injectPreloadScript(html, href) {
  const tag = `<script defer src="${href}"></script>`;
  const entry = html.search(/<script[^>]+type="module"/);
  // Repli sur la fin de l'en-tête si Vite change sa façon d'injecter l'entrée : le
  // préchargement y perd son avance, mais le document reste valide.
  if (entry < 0) return html.replace('</head>', `  ${tag}\n  </head>`);
  return `${html.slice(0, entry)}${tag}\n    ${html.slice(entry)}`;
}

/**
 * Précharge le catalogue de langue dès l'analyse du document (F13).
 *
 * Sans lui, la requête du catalogue ne part qu'une fois le chunk d'entrée téléchargé,
 * analysé et exécuté — et le premier rendu l'attend. Mesuré à 80 ms de latence : le
 * catalogue français démarrait à t+197 ms là où le bundle démarrait à t+96 ms, soit un
 * aller-retour entièrement sérialisé derrière 414 ko de JavaScript.
 *
 * Le document ne peut pas deviner la langue : elle vient de `localStorage` puis de
 * `navigator.languages`, deux sources que seul du JavaScript atteint. L'auditeur proposait
 * un script **inline** avec nonce CSP ; la CSP de production (`script-src 'self'`) n'a ni
 * `unsafe-inline` ni nonce sur cette page, et l'y rouvrir défairait le lot sécurité. Un
 * fichier externe de quelques centaines d'octets passe par `'self'` sans toucher à la CSP :
 * son aller-retour se recouvre avec celui du bundle, cent fois plus gros.
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
      // Aucun catalogue repéré : on ne touche pas au document plutôt que d'y poser un
      // script qui ne préchargerait rien.
      if (Object.keys(map).length === 0) return;
      const { base: baseLocale, codes } = localeRegistry();
      const source = i18nPreloadSnippet({
        map,
        fullLocales: localesCoveringBaseCatalog(),
        codes,
        base: baseLocale,
        storageKey: LOCALE_STORAGE_KEY,
      });
      // Nom haché comme les autres assets : le contenu change avec les empreintes des
      // catalogues, et nginx sert `/assets/` en `immutable`.
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
  define: {
    // Lue par `src/v2/i18n/index.ts`. Chaîne littérale plutôt que tableau : le
    // remplacement est textuel, et une virgule est plus courte qu'un JSON de tableau.
    'import.meta.env.I18N_FULL_LOCALES': JSON.stringify(localesCoveringBaseCatalog().join(',')),
  },
  // Conservation des bannières de licence des dépendances dans le bundle livré au
  // navigateur : MIT, BSD et ISC exigent que leur notice accompagne toute redistribution,
  // or esbuild les supprime par défaut à la minification. L'attribution complète reste
  // dans THIRD-PARTY-NOTICES.md ; ceci garantit qu'elle voyage aussi avec le code servi.
  esbuild: {
    legalComments: 'inline',
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * Socle applicatif dans son propre fichier (D3) : React, le routeur, la couche de
         * données. Le moindre correctif invalidait tout, et le navigateur retéléchargeait
         * ces bibliothèques inchangées à chaque déploiement.
         *
         * On ne groupe QUE ce qui est de toute façon chargé au démarrage. Nommer un chunk
         * pour three, Spark ou Excalidraw les ferait remonter en import statique du point
         * d'entrée — ils sont chargés à la demande, et le resteraient sur le papier tout
         * en étant téléchargés d'emblée.
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
      // Preview testé contre le backend conteneurisé (port hôte 3430)
      '/api': {
        target: 'http://localhost:3430',
        changeOrigin: true,
      },
      // Sans lui, aucun événement temps réel (présence, hls:changed, markers…) en preview.
      '/socket.io': {
        target: 'ws://localhost:3430',
        ws: true,
      },
    },
  },
});
