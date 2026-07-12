/**
 * Cadre de review à aspect fixe (Phase 15/16, V6). Le viewport 3D/splat rend dans un cadre
 * **letterboxé** d'aspect constant (issu de la caméra de présentation), et non plus étiré à la
 * taille de l'écran : la mise en scène (framing, focale, DoF) et les annotations 2D normalisées
 * restent alignées quelle que soit la taille de la fenêtre.
 *
 * Helper pur (testable) : plus grand rectangle d'aspect `aspect` (largeur/hauteur) tenant dans
 * `containerW × containerH`, centré. Renvoie le rect en pixels (left/top/width/height).
 */
export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Aspect par défaut du cadre de review quand aucune caméra de présentation ne le fixe (16:9). */
export const DEFAULT_REVIEW_ASPECT = 16 / 9;

export function reviewFrame(aspect: number, containerW: number, containerH: number): FrameRect {
  // Repli défensif : dimensions/aspect invalides → on remplit le conteneur (comportement neutre).
  if (!Number.isFinite(aspect) || aspect <= 0 || containerW <= 0 || containerH <= 0) {
    return { left: 0, top: 0, width: Math.max(0, containerW), height: Math.max(0, containerH) };
  }
  const containerAspect = containerW / containerH;
  let width: number;
  let height: number;
  if (containerAspect > aspect) {
    // Conteneur plus large que le cadre → bandes verticales, hauteur pleine.
    height = containerH;
    width = height * aspect;
  } else {
    // Conteneur plus étroit/haut → bandes horizontales, largeur pleine.
    width = containerW;
    height = width / aspect;
  }
  return {
    left: (containerW - width) / 2,
    top: (containerH - height) / 2,
    width,
    height,
  };
}
