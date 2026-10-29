// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import type { SplatViewer } from '../review/splat/useSplat';
import {
  applyMaskIndices,
  applySavedVolumes,
  fetchMaskIndices,
} from '../review/splat/editor/persistence/applyEdits';
import { applySubsetOps, fetchSubsetOps } from '../review/splat/editor/persistence/subsetOps';
import { disposeVolume, type VolumeRuntime } from '../review/splat/editor/volumes/cropVolume';
import { applyLod } from '../review/splat/scene/lod';
import type { ClientMediaSource } from './clientTypes';

/**
 * Replays, for the guest, everything the studio recorded on a splat: transform and
 * orientation flip, crop volumes, deletion mask, subset transforms, camera pose with depth of
 * field, default LOD mode.
 *
 * The original file is never touched (project rule). These are exactly the same
 * non-destructive operations the internal review replays for an artist, so the guest sees the
 * cleaned splat, not the raw scan. Nothing is written: no editor is mounted.
 */
export function useClientSplatReplay(splat: SplatViewer, source: ClientMediaSource | undefined): void {
  const { ready, applyTransform, setBaseFlip, getSceneHandle, restoreCamera } = splat;
  const edits = source?.splatEdits ?? null;
  const savedTransform = edits?.transform ?? null;
  const savedFlip = edits?.baseFlip ?? true;
  const savedVolumes = edits?.volumes ?? null;
  const maskUrl = source?.splatMaskUrl ?? null;
  const subsetUrl = source?.splatSubsetUrl ?? null;
  const presentation = source?.splatPresentation ?? null;

  useEffect(() => {
    if (!ready) return;
    applyTransform(savedTransform);
    setBaseFlip(savedFlip);
  }, [ready, applyTransform, savedTransform, setBaseFlip, savedFlip]);

  useEffect(() => {
    if (!ready) return;
    const handle = getSceneHandle();
    if (!handle) return;
    let disposed = false;
    let created: VolumeRuntime[] = [];
    void (async () => {
      if (savedVolumes?.length) {
        created = await applySavedVolumes(handle, savedVolumes, false);
        if (disposed) created.forEach(disposeVolume);
      }
      if (maskUrl) {
        const indices = await fetchMaskIndices(maskUrl).catch(() => []);
        if (!disposed && indices.length) applyMaskIndices(handle, indices);
      }
      if (subsetUrl) {
        const ops = await fetchSubsetOps(subsetUrl).catch(() => []);
        if (!disposed && ops.length) applySubsetOps(handle, ops);
      }
    })();
    return () => {
      disposed = true;
      created.forEach(disposeVolume);
    };
  }, [ready, getSceneHandle, savedVolumes, maskUrl, subsetUrl]);

  // Camera pose and DoF: the persisted staging takes precedence over `useSplat`'s auto-framing.
  const camera = presentation?.camera ?? null;
  const dof = presentation?.dof ?? null;
  useEffect(() => {
    if (!ready || !camera) return;
    restoreCamera(dof ? { ...camera, ...dof } : camera);
  }, [ready, restoreCamera, camera, dof]);

  // Default LOD chosen by the studio. `auto` stays out of scope here: it relies on a state machine
  // driven by measured FPS, which belongs to the internal inspection HUD.
  const lodDefault = presentation?.lodDefault ?? 'auto';
  useEffect(() => {
    if (!ready || lodDefault === 'auto' || lodDefault === 'off') return;
    const handle = getSceneHandle();
    if (!handle) return;
    applyLod(handle.spark, true, lodDefault === 'streaming');
    return () => applyLod(handle.spark, false, false);
  }, [ready, getSceneHandle, lodDefault]);
}
