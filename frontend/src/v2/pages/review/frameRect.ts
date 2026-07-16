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

/**
 * Paramètres `camera.setViewOffset` étendant la vue du cadre fixe à tout le conteneur
 * (Phase 25 — viewer plein espace) : la caméra garde l'aspect/fov du cadre de livraison
 * (`fullWidth × fullHeight` = guide), et rend le conteneur entier comme une sous-vue élargie
 * centrée (offsets négatifs). Le contenu du guide reste identique pour tous les écrans.
 */
export function frameViewOffset(
  aspect: number,
  containerW: number,
  containerH: number,
): { fullWidth: number; fullHeight: number; x: number; y: number; width: number; height: number } {
  const guide = reviewFrame(aspect, containerW, containerH);
  return {
    fullWidth: guide.width,
    fullHeight: guide.height,
    // `|| 0` : normalise le -0 produit par la négation d'un bord collé (lisibilité des tests).
    x: -guide.left || 0,
    y: -guide.top || 0,
    width: containerW,
    height: containerH,
  };
}

/** Coordonnée d'annotation hors du cadre de livraison (espace normalisé 0..1). */
const out = (v: number | undefined) => v != null && (v < 0 || v > 1);

/**
 * `true` si une annotation déborde du cadre de livraison — le dessin hors-cadre est autorisé
 * (Phase 25) mais signalé à l'auteur (les spectateurs sur un écran plus étroit peuvent ne pas
 * tout voir).
 */
export function shapesOutsideFrame(
  shapes: Array<{
    type: string;
    pts?: number[][];
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    cx?: number;
    cy?: number;
    rx?: number;
    ry?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }>,
): boolean {
  return shapes.some((s) => {
    if (s.type === 'path') return (s.pts ?? []).some(([x, y]) => out(x) || out(y));
    if (s.type === 'rect')
      return out(s.x) || out(s.y) || out((s.x ?? 0) + (s.w ?? 0)) || out((s.y ?? 0) + (s.h ?? 0));
    if (s.type === 'ellipse')
      return (
        out((s.cx ?? 0) - (s.rx ?? 0)) ||
        out((s.cx ?? 0) + (s.rx ?? 0)) ||
        out((s.cy ?? 0) - (s.ry ?? 0)) ||
        out((s.cy ?? 0) + (s.ry ?? 0))
      );
    if (s.type === 'arrow') return out(s.x1) || out(s.y1) || out(s.x2) || out(s.y2);
    return out(s.x) || out(s.y); // texte : ancre
  });
}

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
