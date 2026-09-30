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
 * Rejeu, chez l'invité, de tout ce que le studio a enregistré sur un splat : transformation
 * et flip d'orientation, volumes de crop, masque de suppression, transformations de
 * sous-ensembles, pose caméra + profondeur de champ, mode LOD par défaut.
 *
 * Le fichier d'origine n'est jamais touché (règle du projet) : ce sont exactement les mêmes
 * opérations non destructives que la review interne rejoue pour un artiste — l'invité voit
 * donc le splat nettoyé, pas le scan brut. Rien n'est écrit : aucun éditeur n'est monté.
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

  // Pose caméra + DoF : la mise en scène persistée prime sur l'auto-cadrage de `useSplat`.
  const camera = presentation?.camera ?? null;
  const dof = presentation?.dof ?? null;
  useEffect(() => {
    if (!ready || !camera) return;
    restoreCamera(dof ? { ...camera, ...dof } : camera);
  }, [ready, restoreCamera, camera, dof]);

  // LOD par défaut choisi par le studio. `auto` reste hors sujet ici : il suppose la machine
  // à états sur le FPS mesuré, qui appartient au HUD d'inspection interne.
  const lodDefault = presentation?.lodDefault ?? 'auto';
  useEffect(() => {
    if (!ready || lodDefault === 'auto' || lodDefault === 'off') return;
    const handle = getSceneHandle();
    if (!handle) return;
    applyLod(handle.spark, true, lodDefault === 'streaming');
    return () => applyLod(handle.spark, false, false);
  }, [ready, getSceneHandle, lodDefault]);
}
