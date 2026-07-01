import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
})
