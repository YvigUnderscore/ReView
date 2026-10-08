// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vitest/config';

// Le lanceur est du JavaScript de navigateur sans build : on le teste dans un DOM simulé,
// avec ses vrais catalogues de traduction.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['launcher/**/*.test.js'],
  },
});
