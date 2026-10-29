// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import type { RenderMode } from '../../scene/renderModes';
import type { SplatViewer } from '../../useSplat';
import type { VolumesState } from './useVolumes';
import { buildCropChecks, pointCropped } from './cropPoints';

/**
 * Mirror of the crop volumes in the "Points" overlay (Phase 28): in points mode, recomputes
 * (debounced) which centres fall under the volumes, using the same TRS as the serialization, and
 * carves them out via the cloud's `setCropped` channel (separate from the deletion mask).
 * Recomputed when the list of volumes changes or a TRS is modified (gizmo/fields, `trsTick`).
 */
export function useCropReflect(
  splat: SplatViewer,
  opts: { enabled: boolean; renderMode: RenderMode; volumes: VolumesState; trsTick: unknown },
) {
  const { enabled, renderMode, volumes, trsTick } = opts;
  const { ready, getSceneHandle, reflectCropped } = splat;
  const serialize = volumes.serialize;
  useEffect(() => {
    if (!enabled || !ready || renderMode !== 'points') return;
    const handle = getSceneHandle();
    if (!handle) return;
    // Debounced: the gizmo drag advances `trsTick`, so one recomputation per pause is enough.
    const t = setTimeout(() => {
      const checks = buildCropChecks(handle.THREE, serialize());
      const indices: number[] = [];
      if (checks.length > 0)
        handle.mesh.forEachSplat((i, center) => {
          if (pointCropped(center.x, center.y, center.z, checks)) indices.push(i);
        });
      reflectCropped(indices);
    }, 120);
    return () => clearTimeout(t);
  }, [enabled, ready, renderMode, serialize, trsTick, getSceneHandle, reflectCropped]);
}
