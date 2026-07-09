import { describe, expect, it, vi } from 'vitest';
import type { SplatMesh } from '@sparkjsdev/spark';
import { createDebugColor, depthGlsl } from './debugColor';
import { createReveal, revealGlsl } from './reveal';

/** Faux namespace dyno : capture les uniformes et rend les modifiers inspectables. */
function makeDyno() {
  return {
    Gsplat: { type: 'Gsplat' },
    dynoFloat: (value = 0) => ({ value }),
    dynoVec3: (value: { x: number; y: number; z: number }) => ({ value }),
    unindentLines: (s: string) => s.split('\n'),
    gsplatNormal: () => ({ normal: true }),
    dyno: ({ statements }: { statements: (ctx: unknown) => string[] }) => {
      // Vérifie que le GLSL se génère sans erreur avec des noms symboliques.
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

describe('revealGlsl / depthGlsl (GLSL pur)', () => {
  it('chaque type de reveal module l’alpha avec la progression', () => {
    for (const type of ['fade', 'sweep', 'dissolve'] as const) {
      const glsl = revealGlsl(type, 'g', 'u', '-1.0', '3.0');
      expect(glsl).toContain('g.rgba.a *=');
    }
    expect(revealGlsl('sweep', 'g', 'u', '-1.0', '3.0')).toContain('g.center.y');
    expect(revealGlsl('dissolve', 'g', 'u', '-1.0', '3.0')).toContain('g.index');
  });

  it('la heatmap de profondeur colore par distance caméra', () => {
    const glsl = depthGlsl('g', 'cam', 'a', 'b');
    expect(glsl).toContain('distance(g.center, cam)');
    expect(glsl).toContain('g.rgba.rgb = mix(');
  });
});

describe('createReveal', () => {
  it('attache un objectModifier, pilote la progression, se retire proprement', () => {
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
  it('normales : worldModifier statique ; depth : uniformes caméra recalés', () => {
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
