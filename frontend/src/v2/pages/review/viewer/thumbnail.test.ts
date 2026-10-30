// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { toThumbnail } from './thumbnail';

/**
 * `toThumbnail` is the only purely logical piece of the splat scene layer (the other helpers
 * depend on WebGL/Spark, covered by typecheck/build). Here we check the deterministic guards:
 * a canvas without dimensions produces no thumbnail.
 */
describe('toThumbnail', () => {
  it('returns null if the canvas has a zero width', () => {
    const c = document.createElement('canvas');
    c.width = 0;
    c.height = 150;
    expect(toThumbnail(c)).toBeNull();
  });

  it('returns null if the canvas has a zero height', () => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 0;
    expect(toThumbnail(c)).toBeNull();
  });

  it('does not throw and returns string|null for a sized canvas', () => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 150;
    const out = toThumbnail(c);
    expect(out === null || typeof out === 'string').toBe(true);
  });
});
