// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatMesh } from '@sparkjsdev/spark';

/**
 * Colorisations d'inspection CG/VFX (10.G-V6) : modifiers dyno (GLSL) — **normales** (dérivées
 * de l'orientation/échelle de chaque gaussienne) ou **profondeur** (heatmap distance caméra).
 * Outil local (non persisté), togglé dans le panneau de réglages du HUD. Le namespace `dyno`
 * est injecté par l'appelant (import dynamique) — testable avec un faux namespace.
 */
export type DebugColorMode = 'none' | 'normal' | 'depth';
type DynoNs = typeof import('@sparkjsdev/spark').dyno;

/** GLSL de la heatmap de profondeur (pur, testable) : proche = chaud, loin = froid. */
export function depthGlsl(g: string, camPos: string, dMin: string, dMax: string): string {
  return `float d = clamp((distance(${g}.center, ${camPos}) - ${dMin}) / max(${dMax} - ${dMin}, 1e-4), 0.0, 1.0);
${g}.rgba.rgb = mix(vec3(1.0, 0.45, 0.1), vec3(0.15, 0.35, 1.0), d);`;
}

export interface DebugColorRuntime {
  /** Recale la caméra et la plage de distances (mode depth, appelé chaque frame). */
  updateCamera(pos: { x: number; y: number; z: number }, dMin: number, dMax: number): void;
  dispose(): void;
}

export function createDebugColor(
  dyno: DynoNs,
  mesh: SplatMesh,
  mode: Exclude<DebugColorMode, 'none'>,
): DebugColorRuntime {
  const detach = () => {
    mesh.worldModifier = undefined;
    mesh.updateGenerator();
  };

  if (mode === 'normal') {
    mesh.worldModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => ({
      gsplat: dyno.dyno({
        inTypes: { gsplat: dyno.Gsplat, n: 'vec3' },
        outTypes: { gsplat: dyno.Gsplat },
        inputs: { gsplat, n: dyno.gsplatNormal(gsplat!) },
        statements: ({ inputs, outputs }) =>
          dyno.unindentLines(
            `${outputs.gsplat} = ${inputs.gsplat};\n${outputs.gsplat}.rgba.rgb = ${inputs.n} * 0.5 + 0.5;`,
          ),
      }).outputs.gsplat,
    }));
    mesh.updateGenerator();
    return { updateCamera: () => undefined, dispose: detach };
  }

  // Mode profondeur : uniformes caméra + plage, recalés à chaque frame par l'appelant.
  // Three accepte tout objet {x,y,z} pour un uniform vec3 (setValueV3f) — cast du typage strict.
  const camVec = { x: 0, y: 0, z: 0 };
  const camPos = dyno.dynoVec3(camVec as unknown as import('three').Vector3);
  const dMin = dyno.dynoFloat(0);
  const dMax = dyno.dynoFloat(1);
  mesh.worldModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => ({
    gsplat: dyno.dyno({
      inTypes: { gsplat: dyno.Gsplat, camPos: 'vec3', dMin: 'float', dMax: 'float' },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, camPos, dMin, dMax },
      statements: ({ inputs, outputs }) =>
        dyno.unindentLines(
          `${outputs.gsplat} = ${inputs.gsplat};\n` +
            depthGlsl(
              String(outputs.gsplat),
              String(inputs.camPos),
              String(inputs.dMin),
              String(inputs.dMax),
            ),
        ),
    }).outputs.gsplat,
  }));
  mesh.updateGenerator();
  return {
    updateCamera(pos, min, max) {
      camVec.x = pos.x;
      camVec.y = pos.y;
      camVec.z = pos.z;
      dMin.value = min;
      dMax.value = max;
      mesh.needsUpdate = true;
    },
    dispose: detach,
  };
}
