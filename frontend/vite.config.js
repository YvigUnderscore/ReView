import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Le worker de compression splat charge `webp.wasm` via
// `new URL("webp.wasm", import.meta.url)` → résolu à /assets/webp.wasm au runtime.
// Vite émet le wasm sous un nom hashé : on copie une version au nom stable attendu.
function copyWebpWasm() {
  return {
    name: 'copy-webp-wasm',
    apply: 'build',
    closeBundle() {
      const src = resolve(process.cwd(), 'node_modules/@playcanvas/splat-transform/lib/webp.wasm')
      const destDir = resolve(process.cwd(), 'dist/assets')
      if (existsSync(src)) {
        mkdirSync(destDir, { recursive: true })
        copyFileSync(src, resolve(destDir, 'webp.wasm'))
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), copyWebpWasm()],
  // Les libs de compression splat embarquent leur propre wasm + worker chargés via
  // `new URL(..., import.meta.url)`. Les exclure de la pré-optimisation esbuild évite
  // que cette résolution casse en production (bug SOG : webp.wasm introuvable).
  optimizeDeps: {
    exclude: ['@playcanvas/splat-transform', 'playcanvas'],
  },
  worker: {
    format: 'es',
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
      }
    }
  },
  build: {
    rollupOptions: {
      external: [],
    },
  },
})
