// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { normalizeRoute } from './metrics';

describe('normalizeRoute', () => {
  it('agrège les ids numériques', () => {
    expect(normalizeRoute('/api/media/241/hls/master.m3u8')).toBe('/api/media/:id/hls/master.m3u8');
    expect(normalizeRoute('/api/projects/389?tab=shares')).toBe('/api/projects/:id');
  });
  it('agrège les tokens hex longs', () => {
    expect(normalizeRoute('/api/client/2581683afc4d61c8a918a187885e21ac')).toBe('/api/client/:token');
  });
  it('borne la longueur', () => {
    expect(normalizeRoute('/x'.repeat(100)).length).toBeLessThanOrEqual(80);
  });
});
