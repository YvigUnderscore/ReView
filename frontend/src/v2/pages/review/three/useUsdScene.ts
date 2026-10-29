// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import type { MediaResp } from '../reviewTypes';
import type { ViewerSceneHandle } from '../viewer/sceneHandle';
import { buildRenderedPrimTree, primKinds, promoteToKind, type PrimNode } from './usdScenegraph';
import { useScenegraphView, type ScenegraphView } from './useScenegraphView';
import { createSelectionGlow } from './selectionGlow';
import {
  emptyOverride,
  isEmptyOverride,
  isHidden,
  isolatePrim,
  mergeOverrides,
  normalizeOverride,
  parseClonePath,
  setPrimEdit,
  type PrimEdit,
  type PrimTransform,
  type SceneOverride,
} from './sceneOverride';
import {
  applyPlan,
  indexPrimObjects,
  makePrimResolver,
  planOverride,
  renderedPrimPaths,
  variantActive,
  variantOptionRenderable,
  type IndexedObject,
  type VariantSelection,
} from './sceneOverrideApply';
import type { AlignAxis, AlignMode } from './alignPrims';
import { useSceneClones } from './useSceneClones';
import { usePrimAlign } from './usePrimAlign';
import { usePrimTransforms, type PrimTransformCommit } from './usePrimTransforms';

/**
 * USD scenegraph and "ReView override" of the 3D viewer (Phase 46, 46.C).
 *
 * Three layers compose, from the most stable to the most volatile:
 *  1. the media's **base** override, frozen at publication and replayed for everyone;
 *  2. the **proposal** carried by the selected comment, if any;
 *  3. the viewer's **local exploration**, never recorded until it is attached to a comment or
 *     (before publication) saved as the base override.
 *
 * Everything applies at load time without reconversion: changing a variant, hiding a prim or moving
 * it shows up immediately, including on a published asset.
 */

/** Frames to wait before giving up on indexing (GLB without `usdPath`). */
const MAX_INDEX_FRAMES = 60;

export interface UsdSceneState {
  /** Prim tree, empty if the media is not a parsed USD scene. */
  tree: PrimNode[];
  /** Paths actually present in the GLB (the others are greyed out in the tree). */
  renderedPaths: Set<string>;
  /** Effective override applied to the scene (base + proposal + local exploration). */
  override: SceneOverride;
  /** Active variant options at conversion time. */
  variantDefaults: VariantSelection;
  /** Multi-selection of prims (B1) — the last one is the **primary** (menu pivot). */
  selected: string[];
  /** Last selected prim, or null — the equivalent of the former single selection. */
  primary: string | null;
  /** Selects: replaces the selection, or toggles membership (`additive` = Ctrl+click). */
  select: (path: string | null, opts?: { additive?: boolean }) => void;
  /** Replaces the whole selection (Shift+click range in the tree). */
  selectMany: (paths: string[]) => void;
  /** Prim to which a scene object belongs — the exact leaf, reference table.
   *  Returns null for a **locked** prim (excluded from picking). */
  resolvePrim: (object: THREE.Object3D) => string | null;
  /**
   * Prim designated by a **click in the viewer**: the hit leaf, promoted to the enclosing USD
   * `component` (`exact` — Alt+click — bypasses the promotion). Only click resolution promotes;
   * `resolvePrim` stays the leaf for everything else.
   */
  resolvePick: (object: THREE.Object3D, opts?: { exact?: boolean }) => string | null;
  /** Locked prims: not selectable by clicking in the viewer (B2). */
  locked: ReadonlySet<string>;
  toggleLock: (path: string) => void;
  /** Displayed objects of **all** selected prims — `F` framing, gizmo pivot. */
  selectedObjects: () => THREE.Object3D[];
  /** One representative object per selected prim — each receives the group gizmo's pose. */
  representatives: () => THREE.Object3D[];
  /** Representative object of the primary prim — single-selection compat (gizmo arbitration). */
  selectedObject: THREE.Object3D | null;
  /**
   * End of a group-gizmo drag: the current pose of each representative becomes the override delta
   * of its prim (or its clone) — a single batch. Returns the before/after deltas.
   */
  commitPrimTransforms: (objects: readonly THREE.Object3D[]) => PrimTransformCommit[];
  /** Writes a delta on a prim or a clone (`/prim#id`) — the single undo path of the gizmo. */
  applyPrimTransform: (path: string, transform: PrimTransform | null) => void;
  /** Duplicates a prim (or a clone) into an override clone, selects it, returns its pseudo-path. */
  duplicatePrim: (path: string) => string | null;
  /** Deletes a clone designated by its pseudo-path. */
  deleteClone: (pseudo: string) => void;
  /** Aligns the selection on a world axis (min/center/max of the bounding boxes) — C2. */
  alignSelected: (axis: AlignAxis, mode: AlignMode) => void;
  /** Distributes the centers of the selection at regular intervals along an axis — C2. */
  distributeSelected: (axis: AlignAxis) => void;
  setPrim: (path: string, patch: PrimEdit | null) => void;
  isolate: (path: string) => void;
  setVariant: (prim: string, set: string, option: string) => void;
  /**
   * True if keeping this option will display geometry, given the options already kept on the other
   * sets of the same prim — the menu greys out combinations that were not baked instead of making
   * the object disappear (46.U).
   */
  variantChoiceRenderable: (prim: string, set: string, option: string) => boolean;
  /** Cancels the local exploration and returns to the saved override. */
  revert: () => void;
  /** True if the local exploration differs from what is saved. */
  dirty: boolean;
  /** Tree search and expansion — kept outside the panel, to survive a dock tab change. */
  view: ScenegraphView;
  /** Local delta alone — it is what gets attached to a comment. */
  localDelta: SceneOverride;
  /** Full override to save as the base (pre-publish). */
  merged: SceneOverride;
}

/** Active variant options at conversion time, indexed by prim. */
function defaultsFrom(data: MediaResp | null): VariantSelection {
  const sets = data?.modelSource?.usd?.variantSets ?? [];
  const defaults: VariantSelection = {};
  for (const set of sets) defaults[set.prim] = { ...(defaults[set.prim] ?? {}), [set.name]: set.selected };
  return defaults;
}

export function useUsdScene(
  data: MediaResp | null,
  getSceneHandle: () => ViewerSceneHandle | null,
  ready: boolean,
  /** Proposal of the selected comment, replayed on top of the base override. */
  commentOverride: SceneOverride | null,
  /** Publishes the local delta so it is attached to the next comment (46.D). */
  onLocalDelta?: (delta: SceneOverride | null) => void,
): UsdSceneState {
  const usd = data?.modelSource?.usd ?? null;
  const [local, setLocal] = useState<SceneOverride>(emptyOverride);
  const [selected, setSelected] = useState<string[]>([]);
  const [locked, setLocked] = useState<ReadonlySet<string>>(new Set());
  const [indexed, setIndexed] = useState<IndexedObject<THREE.Object3D>[]>([]);

  /**
   * Media change (another asset of the version): the local exploration — isolation, visibilities,
   * selection — belongs to the scene being left and must not carry over (46.K).
   * Adjusted during render (`useChromeState` pattern), not in an effect.
   */
  const mediaId = data?.media.id ?? null;
  const [lastMediaId, setLastMediaId] = useState(mediaId);
  if (lastMediaId !== mediaId) {
    setLastMediaId(mediaId);
    setLocal(emptyOverride());
    setSelected([]);
    setLocked(new Set());
    setIndexed([]);
  }
  // The pending delta awaiting a comment is also dropped along with the scene that carried it.
  // Triggered by the media, not by the callback identity: hence an effect event.
  const dropLocalDelta = useEffectEvent(() => onLocalDelta?.(null));
  useEffect(() => {
    dropLocalDelta();
  }, [mediaId]);

  const variantDefaults = useMemo(() => defaultsFrom(data), [data]);
  const base = useMemo(() => normalizeOverride(data?.usdOverride), [data?.usdOverride]);

  /** What is saved (base + proposal), without the local exploration. */
  const stored = useMemo(() => mergeOverrides(base, commentOverride), [base, commentOverride]);
  const override = useMemo(() => mergeOverrides(stored, local), [stored, local]);

  /**
   * Indexing of the loaded model: this is where the original state of each object is recorded,
   * which serves as the reference for the idempotent application of the delta. Derived from the
   * model rather than stored as state — it only **reads** the Three scene, never modifies it.
   */
  // **Stable** key: the TanStack query returns a new object on every invalidation. Indexing on its
  // identity would re-capture as "original state" transforms already modified by the override,
  // which would then compound on every refresh.
  const primPathsKey = useMemo(() => (usd?.prims ?? []).map((p) => p.path).join('|'), [usd]);

  /**
   * Indexing of the loaded model — records the original state that serves as the reference for the
   * idempotent application of the delta.
   *
   * `ready` must signal the **Three scene actually built** (`useModel3DThree.ready`), not "the media
   * is displayable": the viewer exposes its scene imperatively, and reading a `modelObject` not yet
   * set left the index empty forever — the scenegraph then drove nothing anymore: neither the view,
   * nor the selection, nor the halo.
   */
  useEffect(() => {
    // Media without a USD scenegraph: nothing to index, and above all no wait to launch.
    if (!ready || !primPathsKey) return;
    let frame = 0;
    let attempts = 0;
    const paths = primPathsKey.split('|');
    const tryIndex = () => {
      const root = getSceneHandle()?.modelObject;
      const next = root ? indexPrimObjects(root, paths) : [];
      if (next.length > 0) {
        setIndexed(next);
        return;
      }
      // Bounded safety net: `ready` now guarantees the model is set, but a GLB without `usdPath`
      // (converted before phase 46) would never get an index — we do not leave an animation loop
      // running for nothing.
      if ((attempts += 1) > MAX_INDEX_FRAMES) return;
      frame = requestAnimationFrame(tryIndex);
    };
    tryIndex();
    return () => cancelAnimationFrame(frame);
  }, [ready, getSceneHandle, primPathsKey]);

  // Application: recomputed from the original state, so going back restores exactly the starting
  // scene.
  useEffect(() => {
    if (indexed.length === 0) return;
    applyPlan(planOverride(indexed, override, variantDefaults));
  }, [override, variantDefaults, indexed]);

  // Staging clones (C1): reconciliation of the copies in `useSceneClones`.
  const cloneIndex = useSceneClones(override, indexed, variantDefaults);

  // Mirror of `local`, readable in event handlers without going through an updater.
  const localRef = useRef(local);
  useLayoutEffect(() => {
    localRef.current = local;
  }, [local]);

  /**
   * Any local edit goes through here: it updates the scene **and** publishes the delta for the next
   * comment. Done in the event handler, not in an effect.
   *
   * The delta is computed **outside** the updater: calling `onLocalDelta` (a parent's setState) from
   * the updater is a side effect that React may replay during render — the two states then went into
   * separate renders, and `Model3DReview`'s reset effect saw "no proposal + dirty exploration": the
   * first gizmo delta was cancelled the moment it had just been committed.
   */
  const editLocal = useCallback(
    (next: (current: SceneOverride) => SceneOverride) => {
      const updated = next(localRef.current);
      localRef.current = updated;
      setLocal(updated);
      onLocalDelta?.(isEmptyOverride(updated) ? null : updated);
    },
    [onLocalDelta],
  );

  /** All paths present in the GLB, variant options included. */
  const loadedPaths = useMemo(() => renderedPrimPaths(indexed), [indexed]);

  /**
   * The tree covers the **actually loaded** scene: the parser's prims plus implicit prims for the
   * geometry of baked variants (46.G), which the parser does not compose. Without them, that geometry
   * could not be selected in the tree, and isolation fell back to the parent.
   */
  const tree = useMemo(() => buildRenderedPrimTree(usd?.prims ?? [], loadedPaths), [usd, loadedPaths]);

  // Tree search and expansion: carried by the scene, not by the panel, which is unmounted as soon
  // as the dock tab changes.
  const view = useScenegraphView(tree, mediaId);

  /**
   * Paths actually displayed given the kept variants: the rows of an inactive option are greyed out,
   * like the prims the parser knows but the GLB does not have.
   */
  const renderedPaths = useMemo(() => {
    const shown = new Set<string>();
    for (const entry of indexed)
      if (variantActive(entry, override, variantDefaults)) shown.add(entry.primPath);
    return shown;
  }, [indexed, override, variantDefaults]);

  /** Full index: GLB objects + clone copies (selection, gizmo, halo, framing). */
  const allIndexed = useMemo(() => [...indexed, ...cloneIndex], [indexed, cloneIndex]);

  // Locking (B2): a locked prim no longer responds to viewer picking — the tree, however, remains
  // the way to select or unlock it.
  const baseResolver = useMemo(() => makePrimResolver(allIndexed), [allIndexed]);
  const lockedRef = useRef(locked);
  useLayoutEffect(() => {
    lockedRef.current = locked;
  }, [locked]);
  const resolvePrim = useCallback(
    (object: THREE.Object3D) => {
      const path = baseResolver(object);
      return path && lockedRef.current.has(path) ? null : path;
    },
    [baseResolver],
  );
  /**
   * Click in the viewer: we designate the enclosing **component**, not the leaf that was hit.
   *
   * In a production scene, clicking a chair hits `.../Chair_1/Geom/seat/Mesh`; the object the user
   * thinks they are designating is the chair, i.e. the `component` prim of the USD model hierarchy.
   * Promotion happens **only here**: `resolvePrim` stays the leaf, and nothing is ever promoted when
   * writing an override — already recorded paths target leaves, and an override set on the component
   * would no longer overlay the same prim.
   *
   * Two safeguards: the ancestor must be **indexed** (otherwise the selection would have no halo, no
   * framing, no gizmo), and the lock is re-checked **after** promotion — otherwise locking a chair
   * would no longer prevent grabbing it through one of its meshes.
   *
   * `exact` (Alt+click) descends to the leaf, to target a precise part of the object.
   */
  const kinds = useMemo(() => primKinds(usd?.prims ?? []), [usd]);
  const pickable = useMemo(() => new Set(loadedPaths), [loadedPaths]);
  const resolvePick = useCallback(
    (object: THREE.Object3D, opts?: { exact?: boolean }) => {
      const leaf = resolvePrim(object);
      // A staging clone (`/prim#id`) has no USD ancestor: "climbing" would fall back to its source
      // prim, and clicking a copy would select the original.
      if (opts?.exact || leaf === null || parseClonePath(leaf)) return leaf;
      const promoted = promoteToKind(leaf, { kinds, selectable: pickable });
      return promoted !== null && lockedRef.current.has(promoted) ? null : promoted;
    },
    [resolvePrim, kinds, pickable],
  );
  const toggleLock = useCallback((path: string) => {
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const primary = selected[selected.length - 1] ?? null;

  const select = useCallback((path: string | null, opts?: { additive?: boolean }) => {
    setSelected((prev) => {
      // Ctrl+click on empty space: the current selection does not move (as in a DCC).
      if (path === null) return opts?.additive || prev.length === 0 ? prev : [];
      if (!opts?.additive) return [path];
      return prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path];
    });
  }, []);
  const selectMany = useCallback((paths: string[]) => setSelected(paths), []);

  /** Displayed objects of a prim or a clone (visible, active variant). */
  const objectsOf = useCallback(
    (path: string): THREE.Object3D[] => {
      const src = parseClonePath(path)?.path ?? path;
      if (isHidden(override, src)) return [];
      return allIndexed
        .filter((entry) => entry.primPath === path && variantActive(entry, override, variantDefaults))
        .map((entry) => entry.object);
    },
    [allIndexed, override, variantDefaults],
  );

  /** Displayed objects of all selected prims — `F` framing (46.I), gizmo pivot. */
  const selectedObjects = useCallback(
    (): THREE.Object3D[] => selected.flatMap((path) => objectsOf(path)),
    [selected, objectsOf],
  );

  /** One representative per selected prim — each receives the group gizmo's pose. */
  const representatives = useCallback(
    (): THREE.Object3D[] =>
      selected.map((path) => objectsOf(path)[0]).filter((o): o is THREE.Object3D => !!o),
    [selected, objectsOf],
  );

  const selectedObject = useMemo(
    () => (primary ? (objectsOf(primary)[0] ?? null) : null),
    [primary, objectsOf],
  );

  // Poses of prims and clones (gizmo commit, duplication, deletion) — see
  // `usePrimTransforms`.
  const { writeTransform, applyPrimTransform, commitPrimTransforms, duplicatePrim, deleteClone } =
    usePrimTransforms({
      getSceneHandle,
      allIndexed,
      override,
      local,
      objectsOf,
      editLocal,
      setSelected,
    });

  // Align / distribute (C2) — see `usePrimAlign`.
  const { alignSelected, distributeSelected } = usePrimAlign({
    getSceneHandle,
    selected,
    objectsOf,
    override,
    editLocal,
    writeTransform,
  });

  /**
   * Selection halo: recomputed when the selection or the override changes (the object may have been
   * moved or hidden). The objects of a hidden prim do not receive a halo.
   */
  useEffect(() => {
    const handle = getSceneHandle();
    if (!handle) return;
    const glow = createSelectionGlow(handle.THREE, handle.scene);
    // The halo takes care of descending to the meshes actually drawn.
    const paths = new Set(selected);
    glow.show(allIndexed.filter((i) => paths.has(i.primPath)).map((i) => i.object));
    return () => glow.dispose();
  }, [selected, allIndexed, override, getSceneHandle]);

  const setPrim = useCallback(
    (path: string, patch: PrimEdit | null) => editLocal((o) => setPrimEdit(o, path, patch)),
    [editLocal],
  );

  const isolate = useCallback(
    (path: string) => {
      // Isolation covers **everything** loaded, not just the prims composed by the parser: without
      // the GLB's own paths (baked variants, levels inserted by Blender), these objects escaped
      // masking and isolation seemed to target the parent.
      const paths = [...new Set([...(usd?.prims ?? []).map((p) => p.path), ...loadedPaths])];
      editLocal((o) => isolatePrim(o, path, paths));
    },
    [usd, loadedPaths, editLocal],
  );

  const setVariant = useCallback(
    (prim: string, set: string, option: string) =>
      editLocal((o) => {
        const current = o.prims[prim]?.variants ?? {};
        return setPrimEdit(o, prim, { variants: { ...current, [set]: option } });
      }),
    [editLocal],
  );

  const variantChoiceRenderable = useCallback(
    (prim: string, set: string, option: string) =>
      variantOptionRenderable(indexed, override, variantDefaults, prim, set, option),
    [indexed, override, variantDefaults],
  );

  const revert = useCallback(() => editLocal(() => emptyOverride()), [editLocal]);

  return {
    tree,
    renderedPaths,
    override,
    variantDefaults,
    selected,
    primary,
    select,
    selectMany,
    resolvePrim,
    resolvePick,
    locked,
    toggleLock,
    selectedObjects,
    representatives,
    selectedObject,
    commitPrimTransforms,
    applyPrimTransform,
    duplicatePrim,
    deleteClone,
    alignSelected,
    distributeSelected,
    setPrim,
    isolate,
    setVariant,
    variantChoiceRenderable,
    revert,
    view,
    dirty: !isEmptyOverride(local),
    localDelta: local,
    merged: override,
  };
}
