// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import type { MediaResp } from '../reviewTypes';
import type { SplatViewer } from './useSplat';
import { applyMaskIndices, applySavedVolumes, fetchMaskIndices } from './editor/persistence/applyEdits';
import { applySubsetOps, fetchSubsetOps } from './editor/persistence/subsetOps';
import { disposeVolume, type VolumeRuntime } from './editor/volumes/cropVolume';

/**
 * Rejeu des éditions persistées **en lecture seule** : transformation et flip d'orientation,
 * puis volumes de crop (sans filaire), masque de suppression et transformations de
 * sous-ensembles. L'éditeur gère ces états lui-même quand il est monté — d'où le retrait
 * complet dès que `showEdit` est vrai. Extrait de `SplatReview` (budget lignes).
 */
export function useSavedSplatEdits(splat: SplatViewer, data: MediaResp, showEdit: boolean): void {
  const { applyTransform, setBaseFlip, ready, getSceneHandle } = splat;
  const saved = data.splatEdits;

  const savedTransform = saved?.transform ?? null;
  const savedFlip = saved?.baseFlip ?? true;
  useEffect(() => {
    if (!showEdit && ready) {
      applyTransform(savedTransform);
      setBaseFlip(savedFlip);
    }
  }, [showEdit, ready, applyTransform, savedTransform, setBaseFlip, savedFlip]);

  // Les éditions comptent pour tous les spectateurs : elles sont rejouées telles quelles.
  const savedVolumes = saved?.volumes ?? null;
  const maskUrl = data.splatMaskUrl;
  const subsetUrl = data.splatSubsetUrl;
  useEffect(() => {
    if (showEdit || !ready) return;
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
  }, [showEdit, ready, getSceneHandle, savedVolumes, maskUrl, subsetUrl]);
}
