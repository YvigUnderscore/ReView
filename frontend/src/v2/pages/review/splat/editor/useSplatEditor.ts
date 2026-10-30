// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IDENTITY_SPLAT_TRANSFORM,
  type SplatEdits,
  type SplatEditsPatch,
  type SplatTransform,
} from '../../reviewTypes';
import { frameCameraToMesh } from '../scene/frameCamera';
import type { RenderMode } from '../scene/renderModes';
import type { SplatViewer } from '../useSplat';
import { frameCameraToSphere } from '../../viewer/frameCamera';
import type { GizmoTargetKind } from '../../viewer/gizmos/gizmoSettings';
import { readMeshTransform } from '../../viewer/gizmos/meshTransform';
import { useGizmoSettings } from '../../viewer/gizmos/useGizmoSettings';
import { useTransformGizmo, type GizmoMode } from '../../viewer/gizmos/useTransformGizmo';
import { hideSplats, rehideSplats, restoreSplats } from './operations/deleteSplats';
import { useEditHistory } from './operations/history';
import { encodeMask } from './persistence/mask';
import { encodeSubsetOps, type SubsetOp } from './persistence/subsetOps';
import { useSplatPersistence } from './persistence/useSplatPersistence';
import { useEditorSuspend } from './useEditorSuspend';
import type { SplatEditDraft } from '../splatEditPart';
import { meshBounds, selectionBounds } from './selection/bounds';
import { useSelection } from './selection/useSelection';
import { useSubsetTransform } from './selection/useSubsetTransform';
import { useEditorShortcuts } from './useEditorShortcuts';
import { useVolumes } from './volumes/useVolumes';
import { useCropReflect } from './volumes/useCropReflect';
import { useT } from '@/v2/i18n';

/** Active editor tool: navigation (default, no tool), gizmo or selection. */
export type EditorTool = 'navigate' | GizmoMode | 'select-rect' | 'select-lasso' | 'brush';

const GIZMO_TOOLS: readonly EditorTool[] = ['translate', 'rotate', 'scale'];

/**
 * State and actions of the splat editor (10.G), modeled on `useModel3D`: active tool
 * (gizmo/selection), display mode, TRS transform + volumes + deletion mask, non-destructive
 * persistence (PATCH `/api/media/:id/splat-edits` + binary mask, toasts), per-splat selection
 * and keyboard shortcuts. The Three logic lives in `gizmos/`, `selection/`, `volumes/` and
 * `scene/`; the components only render.
 */
export function useSplatEditor(
  splat: SplatViewer,
  mediaId: number,
  saved: SplatEdits | null,
  savedMaskUrl: string | null,
  savedSubsetUrl: string | null,
  onSaved: (patch: SplatEditsPatch) => void,
  enabled: boolean,
  /**
   * Is an edit proposal coming from a comment being read? The editor then yields control to the
   * replay, and takes it back intact on exit (`useEditorSuspend`).
   */
  suspended = false,
) {
  const t = useT();
  const { applyTransform, setBaseFlip: applyBaseFlip, setRenderMode: applyRenderMode, ready } = splat;
  // Default navigation mode (11.G): opening the editor activates no gizmo or selection.
  const [tool, setTool] = useState<EditorTool>('navigate');
  const [brushRadius, setBrushRadius] = useState(40);
  const [renderMode, setRenderMode] = useState<RenderMode>('splats');
  const [transform, setTransform] = useState<SplatTransform>(saved?.transform ?? IDENTITY_SPLAT_TRANSFORM);
  // Import orientation flip (11.E): true (default) = Y-down convention corrected.
  const [baseFlip, setBaseFlipState] = useState(saved?.baseFlip ?? true);
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);
  // Cumulative deletion mask (masked indices), serialized as a bitset on save.
  const deletedRef = useRef<Set<number>>(new Set());
  const isHidden = useCallback((index: number) => deletedRef.current.has(index), []);
  const history = useEditHistory();
  // Selection enters the SAME history as edits (Phase 50, lot 12): a lasso, a brush stroke or
  // a "deselect all" are steps like the deletion they prepare, and Ctrl+Z restores them in the
  // order they were made.
  const selection = useSelection(splat, isHidden, history.push);
  const volumes = useVolumes(splat, history.push, markDirty, enabled ? (saved?.volumes ?? null) : null);
  const [deletedCount, setDeletedCount] = useState(0);
  // Subset transform log (Phase 28): cumulative, serialized on save.
  const subsetOpsRef = useRef<SubsetOp[]>([]);
  // Binary volumes found on load (media mask, ops already saved): what lies beyond is this
  // session's gesture, and it alone a proposal carries (lot 14).
  const basesRef = useRef({ mask: 0, subset: 0 });

  const isGizmoTool = GIZMO_TOOLS.includes(tool);

  const onGizmoChange = useCallback((t: SplatTransform) => {
    setTransform(t);
    setDirty(true);
  }, []);
  // A selected volume captures the gizmo: its TRS lives in the Three object (serialized on save),
  // so it is mirrored into a state for the numeric fields (V4) + dirty.
  const [volumeTrs, setVolumeTrs] = useState<SplatTransform | null>(null);
  const activeSdf = volumes.activeSdf;
  const volumeGizmoChange = useCallback((t: SplatTransform) => {
    // Box/ellipsoid: the size derives directly from `scale` (no radius sync, Phase 28).
    setVolumeTrs(t);
    setDirty(true);
  }, []);

  // Syncs the displayed TRS when the gizmo target changes (volume selection/deselection), a
  // state adjustment during render (React "derived state" pattern), not an effect.
  const [prevSdf, setPrevSdf] = useState(activeSdf);
  if (prevSdf !== activeSdf) {
    setPrevSdf(activeSdf);
    setVolumeTrs(activeSdf ? readMeshTransform(activeSdf) : null);
  }

  // Gizmo settings per target type (11.G): remembered separately, persisted in localStorage.
  const targetKind: GizmoTargetKind = activeSdf ? 'volume' : 'splat';
  const gizmo = useGizmoSettings(targetKind);

  // Gizmo undo/redo (Phase 26): at the end of a drag, pushes an undoable operation that replays
  // the TRS before/after on the target (whole splat or active SDF volume).
  const historyPush = history.push;
  const gizmoCommit = useCallback(
    (before: SplatTransform, after: SplatTransform) => {
      const sdf = activeSdf;
      if (sdf) {
        const apply = (t: SplatTransform) => {
          sdf.position.fromArray(t.position);
          sdf.quaternion.fromArray(t.quaternion);
          sdf.scale.fromArray(t.scale);
          setVolumeTrs(t);
          setDirty(true);
        };
        historyPush({
          label: t('splat.transformVolume'),
          undo: () => apply(before),
          redo: () => apply(after),
        });
      } else {
        const apply = (t: SplatTransform) => {
          applyTransform(t);
          setTransform(t);
          setDirty(true);
        };
        historyPush({
          label: t('splat.transformSplat'),
          undo: () => apply(before),
          redo: () => apply(after),
        });
      }
    },
    [activeSdf, applyTransform, historyPush, t],
  );

  // Subset TRS (Phase 28): non-empty selection and no volume targeted, so the gizmo acts on the
  // selected splats only (at their barycentre), not on the whole mesh.
  const hasSubset = enabled && isGizmoTool && selection.selected.size > 0 && !activeSdf;

  useTransformGizmo(splat, {
    enabled: enabled && isGizmoTool && !hasSubset,
    mode: isGizmoTool ? (tool as GizmoMode) : 'translate',
    target: volumes.activeSdf,
    settings: gizmo.settings,
    onChange: volumes.activeSdf ? volumeGizmoChange : onGizmoChange,
    onCommit: gizmoCommit,
  });

  useSubsetTransform(splat, {
    enabled: hasSubset,
    mode: isGizmoTool ? (tool as GizmoMode) : 'translate',
    selected: selection.selected,
    settings: gizmo.settings,
    pushHistory: history.push,
    onChange: markDirty,
    opsRef: subsetOpsRef,
  });

  /** Numeric field input (V4): applies the TRS to the gizmo target (splat or volume). */
  const commitFields = useCallback(
    (t: SplatTransform) => {
      if (activeSdf) {
        activeSdf.position.fromArray(t.position);
        activeSdf.quaternion.fromArray(t.quaternion);
        activeSdf.scale.fromArray(t.scale);
        setVolumeTrs(t);
      } else {
        applyTransform(t);
        setTransform(t);
      }
      setDirty(true);
    },
    [activeSdf, applyTransform],
  );

  const activeVolumeItem = volumes.volumes.find((v) => v.id === volumes.activeId) ?? null;
  /** Target of the HUD numeric fields: active volume, otherwise the whole splat. */
  const fields = {
    label: activeVolumeItem
      ? `${activeVolumeItem.shape === 'box' ? t('review.box') : t('review.sphere')} ${volumes.volumes.indexOf(activeVolumeItem) + 1}`
      : 'Splat',
    /** Shape of the target (11.G): contextual fields (sphere radius / box half-extents). */
    shape: activeVolumeItem?.shape ?? null,
    value: volumeTrs && activeSdf ? volumeTrs : transform,
    commit: commitFields,
  };

  // Applies the transform saved on load; the gizmo then follows the mesh.
  const savedTransform = saved?.transform ?? null;
  useEffect(() => {
    if (enabled && ready) applyTransform(savedTransform);
  }, [enabled, ready, applyTransform, savedTransform]);

  // Applies the current orientation flip (11.E): persisted on save.
  useEffect(() => {
    if (enabled && ready) applyBaseFlip(baseFlip);
  }, [enabled, ready, applyBaseFlip, baseFlip]);

  /** "Flip" button: toggles the import orientation flip (11.E). */
  const toggleBaseFlip = useCallback(() => {
    setBaseFlipState((f) => !f);
    setDirty(true);
  }, []);

  // Applies the current display mode; restores "splats" on leaving the editor.
  useEffect(() => {
    if (enabled && ready) applyRenderMode(renderMode);
  }, [enabled, ready, applyRenderMode, renderMode]);
  useEffect(() => {
    if (enabled) return () => applyRenderMode('splats');
  }, [enabled, applyRenderMode]);

  // Points mode: the selection tint (carried by the mesh, opacity 0 here) is reflected in the
  // points overlay, on entering the mode and on every change (no-op outside points mode).
  const selectedSet = selection.selected;
  useEffect(() => {
    if (enabled && ready && renderMode === 'points') splat.reflectSelection(selectedSet);
  }, [enabled, ready, renderMode, selectedSet, splat]);
  // Mirrors the crop volumes in the points overlay (Phase 28): debounced recomputation.
  useCropReflect(splat, { enabled, renderMode, volumes, trsTick: volumeTrs });

  /** Deletes (masks) the current selection: undoable operation (undo/redo). */
  const deleteSelection = useCallback(() => {
    const handle = splat.getSceneHandle();
    if (!handle || selection.selected.size === 0) return;
    const hidden = hideSplats(handle, selection.selected);
    if (!hidden) return;
    const deleted = deletedRef.current;
    // The selection that produced the deletion is part of it: it is emptied WITHOUT its own step
    // (`restore`), and the deletion step restores it. A single Ctrl+Z thus brings back the splats
    // **and** the selection: two steps for one gesture would not make sense.
    const selectedBefore = selection.selected;
    for (const i of hidden.indices) deleted.add(i);
    setDeletedCount(deleted.size);
    setDirty(true);
    selection.restore(new Set());
    selection.markDirty(hidden.indices);
    splat.reflectHidden(hidden.indices, true); // immediate reflection in points mode
    history.push({
      label: t('splat.undoDelete'),
      undo: () => {
        restoreSplats(handle, hidden);
        for (const i of hidden.indices) deleted.delete(i);
        setDeletedCount(deleted.size);
        selection.restore(selectedBefore);
        selection.markDirty(hidden.indices);
        splat.reflectHidden(hidden.indices, false);
      },
      redo: () => {
        rehideSplats(handle, hidden);
        for (const i of hidden.indices) deleted.add(i);
        setDeletedCount(deleted.size);
        selection.restore(new Set());
        selection.markDirty(hidden.indices);
        splat.reflectHidden(hidden.indices, true);
      },
    });
  }, [splat, selection, history, t]);

  /** F: frames the current selection (otherwise the whole splat), keeping the view direction. */
  const frameSelection = useCallback(() => {
    const handle = splat.getSceneHandle();
    if (!handle) return;
    const bounds = selectionBounds(handle, selection.selected) ?? meshBounds(handle);
    if (bounds) frameCameraToSphere(handle.camera, handle.controls, bounds.center, bounds.radius);
  }, [splat, selection]);

  /** H: original view (global reframing identical to the initial framing). */
  const frameHome = useCallback(() => {
    const handle = splat.getSceneHandle();
    if (handle) frameCameraToMesh(handle.THREE, handle.mesh, handle.camera, handle.controls);
  }, [splat]);

  // Keyboard shortcuts (extracted into a dedicated hook to stay within the size budget).
  useEditorShortcuts({ enabled, splat, history, deleteSelection, frameSelection, frameHome });

  // Reading a comment's proposal: the local edit leaves the scene, and comes back as it was on
  // exit (lot 14). Without this, the replay and the editor would write into the same cloud, which
  // is why the replay used to be cut off for managers.
  useEditorSuspend({
    enabled,
    suspended,
    splat,
    runtimesRef: volumes.runtimesRef,
    transform,
    baseFlip,
  });

  // Persistence (mask/ops load and save): dedicated hook.
  const buildEdits = useCallback(
    (): SplatEdits => ({ transform, volumes: volumes.serialize(), baseFlip }),
    [transform, volumes, baseFlip],
  );
  const onClean = useCallback(() => setDirty(false), []);
  const persistence = useSplatPersistence({
    splat,
    mediaId,
    enabled,
    savedMaskUrl,
    savedSubsetUrl,
    deletedRef,
    subsetOpsRef,
    setDeletedCount,
    notifyHiddenChanged: selection.markDirty,
    buildEdits,
    basesRef,
    onSaved,
    onClean,
  });

  /**
   * What the current edit proposes to the next comment (lot 14): the bounded part, plus the two
   * binaries encoded on demand.
   *
   * Encoded **on demand**, not stored in a state: a mask can weigh a few hundred kilobytes, and
   * re-serializing it on every editor render would be absurd.
   *
   * Two different treatments, for one reason: the mask is idempotent (the replay masks what is
   * not already masked), so it travels WHOLE as soon as the author added something to it; subset
   * ops are not, so only those the author added travel: those of the media are already applied on
   * the reader's side.
   */
  const buildProposal = useCallback((): SplatEditDraft => {
    const deleted = deletedRef.current;
    const addedOps = subsetOpsRef.current.slice(basesRef.current.subset);
    return {
      edits: buildEdits(),
      mask: deleted.size > basesRef.current.mask ? { bytes: encodeMask(deleted), count: deleted.size } : null,
      subset: addedOps.length > 0 ? { bytes: encodeSubsetOps(addedOps), count: addedOps.length } : null,
    };
  }, [buildEdits]);

  /**
   * Local reset: the edit that has just left in a comment leaves the editor.
   *
   * This is the 3D model mechanism, to the letter (`Model3DReview`: proposal sent means
   * `scene.revert()`). Without it, the same proposal would re-attach itself to the next comment
   * (46.T) and upload its mask a second time.
   */
  const revertEdits = useCallback(() => {
    history.undoAll(); // restores the masked splats and removes the volumes added in the session
    // Back to what the media carries, not to identity: the editor resumes where it had opened.
    // The saved volumes, created outside the history, stayed in place.
    applyTransform(savedTransform);
    setTransform(saved?.transform ?? IDENTITY_SPLAT_TRANSFORM);
    setBaseFlipState(saved?.baseFlip ?? true);
    history.clear();
    setDirty(false);
  }, [applyTransform, history, saved, savedTransform]);

  return {
    tool,
    setTool,
    brushRadius,
    setBrushRadius,
    fields,
    gizmo,
    renderMode,
    setRenderMode,
    transform,
    baseFlip,
    toggleBaseFlip,
    dirty,
    // Serialization of the current edit: read by persistence and, binaries included, by the
    // proposal attached to a comment (lot 14).
    buildEdits,
    buildProposal,
    revertEdits,
    busy: persistence.busy,
    selection,
    deleteSelection,
    deletedCount,
    volumes,
    history,
    save: persistence.save,
  };
}

export type SplatEditorState = ReturnType<typeof useSplatEditor>;
