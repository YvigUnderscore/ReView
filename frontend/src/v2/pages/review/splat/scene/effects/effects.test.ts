// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import type { SplatMesh } from '@sparkjsdev/spark';
import { createDebugColor, depthGlsl } from './debugColor';
import { createReveal, revealGlsl } from './reveal';

/** Fake dyno namespace: captures the uniforms and makes the modifiers inspectable. */
function makeDyno() {
  return {
    Gsplat: { type: 'Gsplat' },
    dynoFloat: (value = 0) => ({ value }),
    dynoVec3: (value: { x: number; y: number; z: number }) => ({ value }),
    unindentLines: (s: string) => s.split('\n'),
    gsplatNormal: () => ({ normal: true }),
    dyno: ({ statements }: { statements: (ctx: unknown) => string[] }) => {
      // Checks that the GLSL generates without error with symbolic names.
      statements({
        inputs: { gsplat: 'in_g', u: 'in_u', n: 'in_n', camPos: 'in_cam', dMin: 'in_min', dMax: 'in_max' },
        outputs: { gsplat: 'out_g' },
      });
      return { outputs: { gsplat: 'g_out' } };
    },
    dynoBlock: (_i: unknown, _o: unknown, construct: (inputs: { gsplat: unknown }) => unknown) =>
      construct({ gsplat: 'g_in' }),
  } as unknown as typeof import('@sparkjsdev/spark').dyno;
}

function makeMesh() {
  return {
    objectModifier: undefined as unknown,
    worldModifier: undefined as unknown,
    needsUpdate: false,
    updateGenerator: vi.fn(),
    getBoundingBox: () => ({ isEmpty: () => false, min: { y: -1 }, max: { y: 3 } }),
  } as unknown as SplatMesh;
}

describe('revealGlsl / depthGlsl (pure GLSL)', () => {
  it('each reveal type modulates the alpha with the progression', () => {
    for (const type of ['fade', 'sweep', 'dissolve'] as const) {
      const glsl = revealGlsl(type, 'g', 'u', '-1.0', '3.0');
      expect(glsl).toContain('g.rgba.a *=');
    }
    expect(revealGlsl('sweep', 'g', 'u', '-1.0', '3.0')).toContain('g.center.y');
    expect(revealGlsl('dissolve', 'g', 'u', '-1.0', '3.0')).toContain('g.index');
  });

  it('the depth heatmap colours by camera distance', () => {
    const glsl = depthGlsl('g', 'cam', 'a', 'b');
    expect(glsl).toContain('distance(g.center, cam)');
    expect(glsl).toContain('g.rgba.rgb = mix(');
  });
});

describe('createReveal', () => {
  it('attaches an objectModifier, drives the progression, removes itself cleanly', () => {
    const dyno = makeDyno();
    const mesh = makeMesh();
    const reveal = createReveal(dyno, mesh, 'sweep');
    expect(mesh.objectModifier).toBeDefined();
    expect(mesh.updateGenerator).toHaveBeenCalledTimes(1);
    reveal.update(0.5);
    expect(mesh.needsUpdate).toBe(true);
    reveal.dispose();
    expect(mesh.objectModifier).toBeUndefined();
    expect(mesh.updateGenerator).toHaveBeenCalledTimes(2);
  });
});

describe('createDebugColor', () => {
  it('normals: static worldModifier; depth: camera uniforms recomputed', () => {
    const dyno = makeDyno();
    const normal = makeMesh();
    const rt1 = createDebugColor(dyno, normal, 'normal');
    expect(normal.worldModifier).toBeDefined();
    rt1.dispose();
    expect(normal.worldModifier).toBeUndefined();

    const depth = makeMesh();
    const rt2 = createDebugColor(dyno, depth, 'depth');
    rt2.updateCamera({ x: 1, y: 2, z: 3 }, 4, 12);
    expect(depth.needsUpdate).toBe(true);
    rt2.dispose();
    expect(depth.worldModifier).toBeUndefined();
  });
});
