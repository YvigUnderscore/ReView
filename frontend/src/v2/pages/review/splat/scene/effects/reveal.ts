import type { SplatMesh } from '@sparkjsdev/spark';

/**
 * Effets d'apparition du splat (10.G-V6) : modifier dyno (GLSL) injecté dans le générateur
 * Spark (`objectModifier` — l'effet suit la transformation du mesh). Le type + la durée sont
 * persistés dans `splatPresentation.reveal` et rejoués pour tous à l'ouverture. Le namespace
 * `dyno` est injecté par l'appelant (import dynamique) — testable avec un faux namespace.
 */
export type RevealType = 'fade' | 'sweep' | 'dissolve';
type DynoNs = typeof import('@sparkjsdev/spark').dyno;

/** GLSL de l'effet (pur, testable) : `g` = gsplat de sortie, `u` = progression 0→1. */
export function revealGlsl(type: RevealType, g: string, u: string, minY: string, maxY: string): string {
  switch (type) {
    case 'sweep': // balayage vertical : révèle du bas vers le haut
      return `float band = max((${maxY} - ${minY}) * 0.08, 1e-4);
float edge = mix(${minY} - band, ${maxY} + band, ${u});
${g}.rgba.a *= 1.0 - smoothstep(edge - band, edge + band, ${g}.center.y);`;
    case 'dissolve': // dissolution : chaque splat apparaît à un seuil pseudo-aléatoire
      return `float rnd = fract(sin(float(${g}.index) * 12.9898) * 43758.5453);
${g}.rgba.a *= smoothstep(rnd - 0.03, rnd + 0.03, ${u} * 1.06 - 0.03);`;
    default: // fade : montée en opacité globale
      return `${g}.rgba.a *= ${u};`;
  }
}

export interface RevealRuntime {
  /** Règle la progression de l'effet (0 = invisible, 1 = rendu normal). */
  update(progress: number): void;
  /** Retire le modifier et rétablit le rendu normal. */
  dispose(): void;
}

export function createReveal(dyno: DynoNs, mesh: SplatMesh, type: RevealType): RevealRuntime {
  const progress = dyno.dynoFloat(0);
  // Bornes verticales du balayage (bbox objet) — littéraux GLSL, figés à la création.
  let minY = 0;
  let maxY = 1;
  try {
    const box = mesh.getBoundingBox(true);
    if (!box.isEmpty()) {
      minY = box.min.y;
      maxY = box.max.y > box.min.y ? box.max.y : box.min.y + 1;
    }
  } catch {
    // bbox indisponible : bornes par défaut (fade/dissolve n'en dépendent pas)
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
