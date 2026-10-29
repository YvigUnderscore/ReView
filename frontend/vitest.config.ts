// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vitest/config';

/**
 * Frontend unit tests (10.F3): Zustand stores, lib (apiClient, uploadClient), pure utilities,
 * **and render tests** (Testing Library) under `src/test/`.
 * happy-dom environment (localStorage, lightweight DOM).
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    // The frontend tooling scripts (build-docs) live outside `src`: their
    // tests are collected here rather than left without a suite.
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    // `vitest.setup.ts` works around a WebAssembly incompatibility; `src/setupTests.ts`
    // installs the DOM base of the render tests (jest-dom, unmounting, missing APIs).
    setupFiles: ['./vitest.setup.ts', './src/setupTests.ts'],
    /**
     * Coverage measurement — inert unless `--coverage` is passed. The per-folder thresholds and
     * the ratchet live in `scripts/check-coverage.mjs` (see the twin comment on the backend side).
     */
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/setupTests.ts',
        'src/test/**',
        'src/**/*.d.ts',
        // Entry point (main.tsx) and declarations: neither carries any logic.
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
});
