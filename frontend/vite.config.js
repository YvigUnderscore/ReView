// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'ws://localhost:3000',
        ws: true,
      }
    }
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
      }
    }
  },
})
