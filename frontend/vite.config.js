// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const MESSAGES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src/v2/i18n/messages');

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
