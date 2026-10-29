// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { z } from 'zod';

/**
 * The Zod schemas a route validates its request with — written by `middleware/validate`, read back by
 * `lib/openapiRoutes` to document the API. Lives in `lib/` so both layers can name it.
 */
export type Schemas = {
  body?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
};
