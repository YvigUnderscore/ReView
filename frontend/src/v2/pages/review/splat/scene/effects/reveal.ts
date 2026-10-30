// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SplatMesh } from '@sparkjsdev/spark';

/**
 * Splat appearance effects (10.G-V6): dyno modifier (GLSL) injected into Spark's generator
 * (`objectModifier`, so the effect follows the mesh transform). The type and duration are
 * persisted in `splatPresentation.reveal` and replayed for everyone on opening. The `dyno`
 * namespace is injected by the caller (dynamic import), so it is testable with a fake namespace.
 */
export type RevealType = 'fade' | 'sweep' | 'dissolve';
type DynoNs = typeof import('@sparkjsdev/spark').dyno;

/** GLSL of the effect (pure, testable): `g` = output gsplat, `u` = progression 0→1. */
export function revealGlsl(type: RevealType, g: string, u: string, minY: string, maxY: string): string {
  switch (type) {
    case 'sweep': // vertical sweep: reveals from bottom to top
      return `float band = max((${maxY} - ${minY}) * 0.08, 1e-4);
float edge = mix(${minY} - band, ${maxY} + band, ${u});
${g}.rgba.a *= 1.0 - smoothstep(edge - band, edge + band, ${g}.center.y);`;
    case 'dissolve': // dissolve: each splat appears at a pseudo-random threshold
      return `float rnd = fract(sin(float(${g}.index) * 12.9898) * 43758.5453);
${g}.rgba.a *= smoothstep(rnd - 0.03, rnd + 0.03, ${u} * 1.06 - 0.03);`;
    default: // fade: global opacity ramp-up
      return `${g}.rgba.a *= ${u};`;
  }
}

export interface RevealRuntime {
  /** Sets the progression of the effect (0 = invisible, 1 = normal rendering). */
  update(progress: number): void;
  /** Removes the modifier and restores normal rendering. */
  dispose(): void;
}

export function createReveal(dyno: DynoNs, mesh: SplatMesh, type: RevealType): RevealRuntime {
  const progress = dyno.dynoFloat(0);
  // Vertical bounds of the sweep (object bbox): GLSL literals, frozen at creation.
  let minY = 0;
  let maxY = 1;
  try {
    const box = mesh.getBoundingBox(true);
    if (!box.isEmpty()) {
      minY = box.min.y;
      maxY = box.max.y > box.min.y ? box.max.y : box.min.y + 1;
    }
  } catch {
    // bbox unavailable: default bounds (fade and dissolve do not depend on them)
  }
  mesh.objectModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => ({
    gsplat: dyno.dyno({
      inTypes: { gsplat: dyno.Gsplat, u: 'float' },
      outTypes: { gsplat: dyno.Gsplat },
      inputs: { gsplat, u: progress },
      statements: ({ inputs, outputs }) =>
        dyno.unindentLines(
          `${outputs.gsplat} = ${inputs.gsplat};\n` +
            revealGlsl(type, String(outputs.gsplat), String(inputs.u), minY.toFixed(5), maxY.toFixed(5)),
        ),
    }).outputs.gsplat,
  }));
  mesh.updateGenerator();
  return {
    update(u: number) {
      progress.value = u;
      mesh.needsUpdate = true;
    },
    dispose() {
      mesh.objectModifier = undefined;
      mesh.updateGenerator();
    },
  };
}
