// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RgbaArray } from '@sparkjsdev/spark';
import type { SplatSceneHandle } from '../../useSplat';

/** Teinte de sélection (orange DCC classique), appliquée à la gaussienne elle-même. */
export const HIGHLIGHT_RGB: readonly [number, number, number] = [255, 170, 51]; // #ffaa33

export interface SelectionHighlight {
  /** Applique la teinte à l'ensemble sélectionné (remplace la sélection précédente). */
  apply(selected: ReadonlySet<number>): void;
  /** Signale des indices dont l'opacité a changé (masquage/restauration) — resynchronisés au prochain apply. */
  markDirty(indices: Iterable<number>): void;
  dispose(): void;
}

/**
 * Surbrillance par teinte (10.G-V2) : injection RGBA **par index** via `RgbaArray`
 * (`SplatMesh.splatRgba`) — la teinte franche remplace la couleur de la gaussienne (fini
 * l'overlay `THREE.Points` qui se noyait dans le rendu). L'override Spark couvrant tous les
 * splats, on capture une base RGBA complète (une seule passe `forEachSplat`, mise en cache)
 * puis on ne réécrit que les indices qui changent. L'alpha d'origine est conservé : les splats
 * masqués (suppression non-destructive) restent invisibles même sous l'override.
 */
export function createSelectionHighlight(
  handle: SplatSceneHandle,
  RgbaArrayCtor: typeof RgbaArray,
): SelectionHighlight {
  const mesh = handle.mesh;
  let rgba: RgbaArray | null = null;
  let work: Uint8Array | null = null; // tampon envoyé au GPU (base + teintes)
  let base: Uint8Array | null = null; // RGBA d'origine (alpha = opacité)
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

  /** Resynchronise l'alpha des indices touchés par un (dé)masquage depuis les données paquées. */
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
      // Dé-teinte des indices sortis de la sélection, teinte des entrants.
      for (const i of tinted) {
        if (!selected.has(i)) work.set(base.subarray(i * 4, i * 4 + 4), i * 4);
      }
      const [tr, tg, tb] = HIGHLIGHT_RGB;
      for (const i of selected) {
        if (tinted.has(i)) continue; // déjà teinté (brush incrémental : n'écrit que les entrants)
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
        // scène déjà démontée : rien à détacher
      }
      rgba?.dispose();
      rgba = null;
      base = null;
      work = null;
    },
  };
}
