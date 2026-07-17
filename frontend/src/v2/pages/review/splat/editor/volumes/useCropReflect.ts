import { useEffect } from 'react';
import type { RenderMode } from '../../scene/renderModes';
import type { SplatViewer } from '../../useSplat';
import type { VolumesState } from './useVolumes';
import { buildCropChecks, pointCropped } from './cropPoints';

/**
 * Reflet des volumes de crop dans l'overlay « Points » (Phase 28) : en mode points, recalcule
 * (débouncé) quels centres tombent sous les volumes — mêmes TRS que la sérialisation — et les
 * escamote via le canal `setCropped` du nuage (séparé du masque de suppression). Recalculé quand
 * la liste des volumes change ou qu'une TRS est modifiée (gizmo/champs, `trsTick`).
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
    // Débouncé : le drag du gizmo fait défiler `trsTick` — un recalcul par pause suffit.
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
