// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // The repo's tooling scripts (SPDX headers, third-party notices) live at the root
    // and have no suite of their own: they are covered here, along with the backend tests.
    include: ['src/**/*.test.ts', '../scripts/**/*.test.mjs'],
    /**
     * Coverage measurement: inert unless `--coverage` is passed.
     *
     * The `json-summary` report is the only one that matters here: it is what
     * `scripts/check-coverage.mjs` reads, which holds the **per-folder** thresholds and the ratchet
     * (a floor never goes back down). The thresholds are deliberately not declared
     * in `coverage.thresholds`: they would then live in two places, and vitest cannot
     * refuse a lowering of a floor.
     *
     * `include` without excluding files that are not imported: a service nobody tests
     * must count for zero, not disappear from the measurement. That is the whole point of the check.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.itest.ts',
        // Scaffolding and plumbing of the integration suite: test tooling.
        'src/integration/**',
        'src/types/**',
        'src/**/*.d.ts',
      ],
    },
  },
});
