// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RgbaArray } from '@sparkjsdev/spark';
import type { SplatSceneHandle } from '../../useSplat';

/** Selection tint (classic DCC orange), applied to the gaussian itself. */
export const HIGHLIGHT_RGB: readonly [number, number, number] = [255, 170, 51]; // #ffaa33

export interface SelectionHighlight {
  /** Applies the tint to the selected set (replaces the previous selection). */
  apply(selected: ReadonlySet<number>): void;
  /** Signals indices whose opacity changed (masking/restoring), resynced at the next apply. */
  markDirty(indices: Iterable<number>): void;
  dispose(): void;
}

/**
 * Tint-based highlight (10.G-V2): RGBA injection **per index** via `RgbaArray`
 * (`SplatMesh.splatRgba`). The solid tint replaces the gaussian's colour, instead of the
 * `THREE.Points` overlay that got lost in the rendering. As the Spark override covers all
 * splats, a full RGBA base is captured (a single `forEachSplat` pass, cached) and then only
 * the indices that change are rewritten. The original alpha is kept: hidden splats
 * (non-destructive deletion) remain invisible even under the override.
 */
export function createSelectionHighlight(
  handle: SplatSceneHandle,
  RgbaArrayCtor: typeof RgbaArray,
): SelectionHighlight {
  const mesh = handle.mesh;
  let rgba: RgbaArray | null = null;
  let work: Uint8Array | null = null; // buffer sent to the GPU (base + tints)
  let base: Uint8Array | null = null; // original RGBA (alpha = opacity)
  let tinted: ReadonlySet<number> = new Set<number>();
  const dirty = new Set<number>();
  let attached = false;

  const buildBase = (): boolean => {
    const n = mesh.packedSplats?.numSplats ?? 0;
    if (n === 0) return false;
    if (!base) {
      const b = new Uint8Array(n * 4);
      mesh.forEachSplat((i, _center, _scales, _quat, opacity, color) => {
        const o = i * 4;
        b[o] = Math.round(color.r * 255);
        b[o + 1] = Math.round(color.g * 255);
        b[o + 2] = Math.round(color.b * 255);
        b[o + 3] = Math.round(opacity * 255);
      });
      base = b;
    }
    if (!rgba) {
      rgba = new RgbaArrayCtor();
      work = rgba.ensureCapacity(n);
      rgba.count = n;
      work.set(base);
    }
    return true;
  };

  /** Resyncs the alpha of the indices touched by a (un)mask from the packed data. */
  const syncDirty = () => {
    const packed = mesh.packedSplats;
    if (!packed || !base || !work || dirty.size === 0) return;
    for (const i of dirty) {
      const alpha = Math.round(packed.getSplat(i).opacity * 255);
      const o = i * 4;
      base[o + 3] = alpha;
      if (tinted.has(i)) work[o + 3] = alpha;
      else work.set(base.subarray(o, o + 4), o);
    }
    dirty.clear();
  };

  const detach = () => {
    if (!attached) return;
    attached = false;
    mesh.splatRgba = null;
    mesh.updateGenerator();
  };

  return {
    apply(selected) {
      if (selected.size === 0) {
        tinted = new Set<number>();
        detach();
        return;
      }
      if (!buildBase() || !base || !work || !rgba) return;
      syncDirty();
      // Un-tint the indices leaving the selection, tint the incoming ones.
      for (const i of tinted) {
        if (!selected.has(i)) work.set(base.subarray(i * 4, i * 4 + 4), i * 4);
      }
      const [tr, tg, tb] = HIGHLIGHT_RGB;
      for (const i of selected) {
        if (tinted.has(i)) continue; // already tinted (incremental brush: writes only the incoming ones)
        const o = i * 4;
        work[o] = tr;
        work[o + 1] = tg;
        work[o + 2] = tb;
        work[o + 3] = base[o + 3];
      }
      tinted = selected;
      rgba.needsUpdate = true;
      if (attached) {
        mesh.needsUpdate = true;
      } else {
        mesh.splatRgba = rgba;
        mesh.updateGenerator();
        attached = true;
      }
    },
    markDirty(indices) {
      for (const i of indices) dirty.add(i);
    },
    dispose() {
      try {
        detach();
      } catch {
        // scene already torn down: nothing to detach
      }
      rgba?.dispose();
      rgba = null;
      base = null;
      work = null;
    },
  };
}
