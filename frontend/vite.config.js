// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
