// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { describeRouter } from '../../lib/openapiRoutes';
import publishRoutes from './publish.routes';

/**
 * Input contract of `POST /api/v1/publish` for the `usd` field. The schema is read from the router
 * itself (as the OpenAPI generator does): what is tested is the validation served in production, not
 * a copy.
 */
const body = describeRouter(publishRoutes, '/api/v1/publish').find(
  (r) => r.method === 'post' && r.path === '/api/v1/publish',
)!.schemas.body!;

const base = { path: 'PROJ/SQ010/SH0100/anim', filename: 'SH0100_set_v001.usd' };

describe('POST /api/v1/publish: usd field', () => {
  it('stays optional: a client that ignores it publishes as before', () => {
    const parsed = body.parse(base) as { usd?: unknown };
    expect(parsed.usd).toBeUndefined();
  });

  it('accepts a selection of variants and fills in the default purpose', () => {
    const parsed = body.parse({
      ...base,
      usd: { variants: { '/World/Set': { modelingVariant: 'hero' } } },
    }) as { usd: { variants: unknown; purpose: string } };
    expect(parsed.usd).toEqual({
      variants: { '/World/Set': { modelingVariant: 'hero' } },
      purpose: 'render',
    });
  });

  it('refuses a purpose outside those the converter can render', () => {
    expect(body.safeParse({ ...base, usd: { purpose: 'beauty' } }).success).toBe(false);
  });

  it('refuses an oversized selection', () => {
    const variants = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [`/World/Asset${i}`, { modelingVariant: 'hero' }]),
    );
    expect(body.safeParse({ ...base, usd: { variants } }).success).toBe(false);
  });
});
