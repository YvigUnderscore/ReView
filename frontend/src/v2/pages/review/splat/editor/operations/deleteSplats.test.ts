// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import type { SplatSceneHandle } from '../../useSplat';
import { hideSplats, rehideSplats, restoreSplats } from './deleteSplats';

/** Dummy handle: 3 splats, one already masked, generator spied (immediate reflection, 11.C). */
function makeHandle() {
  const opacities = [1, 0.5, 0];
  const packed = {
    needsUpdate: false,
    getSplat: (i: number) => ({
      center: null,
      scales: null,
      quaternion: null,
      opacity: opacities[i],
      color: null,
    }),
    setSplat: (i: number, _c: unknown, _s: unknown, _q: unknown, opacity: number) => {
      opacities[i] = opacity;
    },
  };
  const mesh = { packedSplats: packed, updateGenerator: vi.fn() };
  return { handle: { mesh } as unknown as SplatSceneHandle, opacities, packed, mesh };
}

describe('deleteSplats — non-destructive masking + immediate reflection (11.C)', () => {
  it('masks, remembers the original opacities and invalidates the generator', () => {
    const { handle, opacities, packed, mesh } = makeHandle();
    const hidden = hideSplats(handle, [0, 1, 2]);
    expect(hidden).toEqual({ indices: [0, 1], opacities: [1, 0.5] }); // 2 was already masked
    expect(opacities).toEqual([0, 0, 0]);
    expect(packed.needsUpdate).toBe(true);
    expect(mesh.updateGenerator).toHaveBeenCalledTimes(1);
  });

  it('does not touch the generator when there is nothing to mask', () => {
    const { handle, mesh } = makeHandle();
    expect(hideSplats(handle, [2])).toBeNull(); // already masked
    expect(mesh.updateGenerator).not.toHaveBeenCalled();
  });

  it('undo/redo restore, then re-mask, with invalidation each time', () => {
    const { handle, opacities, mesh } = makeHandle();
    const hidden = hideSplats(handle, [0, 1])!;
    restoreSplats(handle, hidden);
    expect(opacities).toEqual([1, 0.5, 0]);
    rehideSplats(handle, hidden);
    expect(opacities).toEqual([0, 0, 0]);
    expect(mesh.updateGenerator).toHaveBeenCalledTimes(3); // hide + restore + rehide
  });
});
