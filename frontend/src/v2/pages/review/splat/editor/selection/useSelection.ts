// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SplatViewer } from '../../useSplat';
import type { EditOp } from '../operations/history';
import { createSelectionHighlight, type SelectionHighlight } from './highlight';
import { captureCenters, selectByShape } from './screenSelect';
import { selectionOp } from './selectionHistory';
import type { SelectCombine, SelectionShape } from './shapes2d';
import { selectByBrush } from './surfaceBrush';
import { useT } from '@/v2/i18n';

/**
 * Per-splat selection (10.G, perf and readability reviewed in V2): set of selected indices,
 * fed by the shapes drawn on screen (rectangle/lasso, Shift = add / Alt = remove).
 * The centres are cached as a `Float32Array` on the first commit (no more `forEachSplat`
 * pass per selection), and the highlight is a **per-index tint** injected into the Spark
 * rendering (`RgbaArray`), visible over the gaussians and restored on deselection.
 * `isHidden` excludes hidden splats (non-destructive deletion) without invalidating the cache.
 *
 * Each selection gesture is a **history step** (`pushHistory`, Phase 50 lot 12): Ctrl+Z restores
 * the previous selection just as it restores a deletion. The current set is kept in a ref in
 * addition to the state: it is what gestures and steps read, so that two brush strokes of the
 * same frame correctly start from the result of the previous one.
 */
export function useSelection(
  splat: SplatViewer,
  isHidden: (index: number) => boolean,
  /** Editor history. Absent (read-only): the selection remains, without a step. */
  pushHistory?: (op: EditOp) => void,
) {
  const t = useT();
  const { getSceneHandle } = splat;
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const selectedRef = useRef<ReadonlySet<number>>(selected);
  const centersRef = useRef<Float32Array | null>(null);
  const highlightRef = useRef<SelectionHighlight | null>(null);
  // Set from before the current brush stroke: a stroke stamps continuously (one call per move),
  // and a hundred steps for a single gesture would make Ctrl+Z unusable. The step is pushed only
  // on release (`endBrush`), with this set as its starting point.
  const strokeRef = useRef<ReadonlySet<number> | null>(null);

  // Applies the tint on each selection change (lazy creation: the Spark import is already cached
  // since the viewer loaded it, but stays out of the initial bundle).
  useEffect(() => {
    if (selected.size === 0 && !highlightRef.current) return;
    const handle = getSceneHandle();
    if (!handle) return;
    let cancelled = false;
    void (async () => {
      if (!highlightRef.current) {
        const { RgbaArray } = await import('@sparkjsdev/spark');
        if (cancelled || highlightRef.current) return;
        highlightRef.current = createSelectionHighlight(handle, RgbaArray);
      }
      if (!cancelled) highlightRef.current.apply(selected);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, getSceneHandle]);

  // Cleanup on editor unmount (detaches the override and releases the texture).
  useEffect(
    () => () => {
      highlightRef.current?.dispose();
      highlightRef.current = null;
      centersRef.current = null;
    },
    [],
  );

  /** Replaces the selection **without** a history step: undo/redo, and deletion (which has its own). */
  const restore = useCallback((next: ReadonlySet<number>) => {
    selectedRef.current = next;
    setSelected(next);
  }, []);

  /** Replaces the selection and records a step, unless the gesture changed nothing. */
  const record = useCallback(
    (next: ReadonlySet<number>) => {
      const before = selectedRef.current;
      restore(next);
      const op = selectionOp(t('splat.undoSelect'), before, next, restore);
      if (op) pushHistory?.(op);
    },
    [restore, pushHistory, t],
  );

  /** Splat centres, captured once; `null` until the scene is mounted. */
  const centersOf = useCallback(
    (mesh: Parameters<typeof captureCenters>[0]) => (centersRef.current ??= captureCenters(mesh)),
    [],
  );

  /** Applies a shape drawn on screen (on drag release) to the current selection. */
  const commitShape = useCallback(
    (shape: SelectionShape, combine: SelectCombine, viewport: { width: number; height: number }) => {
      const handle = getSceneHandle();
      if (!handle) return;
      const centers = centersOf(handle.mesh);
      record(selectByShape(handle, centers, isHidden, viewport, shape, selectedRef.current, combine));
    },
    [getSceneHandle, isHidden, centersOf, record],
  );

  /** Surface brush stroke (V3): screen disc and depth band at the touched point. */
  const commitBrush = useCallback(
    (
      point: { x: number; y: number },
      radiusPx: number,
      combine: SelectCombine,
      viewport: { width: number; height: number },
    ) => {
      const handle = getSceneHandle();
      if (!handle) return;
      const centers = centersOf(handle.mesh);
      const prev = selectedRef.current;
      const next = selectByBrush(handle, centers, isHidden, viewport, point, radiusPx, prev, combine);
      if (!next) return;
      strokeRef.current ??= prev;
      restore(next);
    },
    [getSceneHandle, isHidden, centersOf, restore],
  );

  /** End of the brush stroke (release, pointer cancel): the whole stroke makes one step. */
  const endBrush = useCallback(() => {
    const before = strokeRef.current;
    strokeRef.current = null;
    if (!before) return;
    const op = selectionOp(t('splat.undoSelect'), before, selectedRef.current, restore);
    if (op) pushHistory?.(op);
  }, [restore, pushHistory, t]);

  /** Signals (un)masked indices; the tint resyncs their alpha at the next apply. */
  const markDirty = useCallback((indices: Iterable<number>) => {
    highlightRef.current?.markDirty(indices);
  }, []);

  /** "Deselect all": a user gesture, hence a step like any other. */
  const clear = useCallback(() => record(new Set()), [record]);

  return { selected, commitShape, commitBrush, endBrush, clear, restore, markDirty };
}

export type SelectionState = ReturnType<typeof useSelection>;
