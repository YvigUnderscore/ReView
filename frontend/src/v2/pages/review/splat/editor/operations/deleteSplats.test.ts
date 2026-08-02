// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import type { SplatSceneHandle } from '../../useSplat';
import { hideSplats, rehideSplats, restoreSplats } from './deleteSplats';

/** Poignée factice : 3 splats dont un déjà masqué, générateur espionné (reflet immédiat 11.C). */
function makeHandle() {
  const opacities = [1, 0.5, 0];
  const packed = {
    needsUpdate: false,
    getSplat: (i: number) => ({
      center: null,
      scales: null,
      quaternion: null,
      opacity: opacities[i]!,
      color: null,
    }),
    setSplat: (i: number, _c: unknown, _s: unknown, _q: unknown, opacity: number) => {
      opacities[i] = opacity;
    },
  };
  const mesh = { packedSplats: packed, updateGenerator: vi.fn() };
  return { handle: { mesh } as unknown as SplatSceneHandle, opacities, packed, mesh };
}

describe('deleteSplats — masquage non-destructif + reflet immédiat (11.C)', () => {
  it('masque, mémorise les opacités d’origine et invalide le générateur', () => {
    const { handle, opacities, packed, mesh } = makeHandle();
    const hidden = hideSplats(handle, [0, 1, 2]);
    expect(hidden).toEqual({ indices: [0, 1], opacities: [1, 0.5] }); // le 2 était déjà masqué
    expect(opacities).toEqual([0, 0, 0]);
    expect(packed.needsUpdate).toBe(true);
    expect(mesh.updateGenerator).toHaveBeenCalledTimes(1);
  });

  it('ne touche pas au générateur quand il n’y a rien à masquer', () => {
    const { handle, mesh } = makeHandle();
    expect(hideSplats(handle, [2])).toBeNull(); // déjà masqué
    expect(mesh.updateGenerator).not.toHaveBeenCalled();
  });

  it('undo/redo restaurent puis re-masquent, avec invalidation à chaque fois', () => {
    const { handle, opacities, mesh } = makeHandle();
    const hidden = hideSplats(handle, [0, 1])!;
    restoreSplats(handle, hidden);
    expect(opacities).toEqual([1, 0.5, 0]);
    rehideSplats(handle, hidden);
    expect(opacities).toEqual([0, 0, 0]);
    expect(mesh.updateGenerator).toHaveBeenCalledTimes(3); // hide + restore + rehide
  });
});
