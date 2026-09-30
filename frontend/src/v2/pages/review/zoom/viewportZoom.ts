// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Arithmétique du zoom/pan d'un calque média centré dans sa boîte (lecteur vidéo).
 *
 * La visionneuse image zoome de 0,1× à 20× depuis toujours ; le lecteur vidéo, lui,
 * n'avait aucun zoom — impossible d'aller regarder un bord de rotoscopie ou un aliasing
 * de près. Le calque est **centré** par la mise en page (l'image est ajustée à la boîte),
 * on raisonne donc en écart au centre du conteneur : `translate(x, y) scale(s)` avec une
 * origine centrale. Un point à `d` du centre reste sous le curseur quand l'échelle passe
 * de `s` à `s'` si l'on repose l'offset à `d − (d − offset)·s'/s`.
 */

export interface ZoomState {
  scale: number;
  /** Décalage en pixels écran, appliqué APRÈS l'échelle (translate puis scale). */
  x: number;
  y: number;
}

/** Vue ajustée à la boîte : c'est l'état de départ et celui où le zoom disparaît. */
export const ZOOM_FIT: ZoomState = { scale: 1, x: 0, y: 0 };

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 32;

export const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(scale) ? scale : 1));

/** L'image est-elle simplement ajustée (ni zoomée, ni déplacée) ? */
export const isFit = (s: ZoomState): boolean => s.scale === 1 && s.x === 0 && s.y === 0;

/**
 * Zoome vers `target`, en gardant fixe le point situé à (`dx`, `dy`) du centre du
 * conteneur. `dx`/`dy` en pixels écran, non transformés.
 */
export function zoomTo(state: ZoomState, target: number, dx: number, dy: number): ZoomState {
  const scale = clampScale(target);
  const k = scale / state.scale;
  if (k === 1) return state;
  return { scale, x: dx - (dx - state.x) * k, y: dy - (dy - state.y) * k };
}

/** Multiplie l'échelle courante autour du point (`dx`, `dy`) relatif au centre. */
export const zoomBy = (state: ZoomState, factor: number, dx = 0, dy = 0): ZoomState =>
  zoomTo(state, state.scale * factor, dx, dy);

/** Déplace la vue de (`dx`, `dy`) pixels écran. */
export const panBy = (state: ZoomState, dx: number, dy: number): ZoomState => ({
  ...state,
  x: state.x + dx,
  y: state.y + dy,
});

/** Style du calque transformé — vide à l'ajustement, pour ne rien changer au rendu. */
export function zoomStyle(state: ZoomState): { transform?: string; transformOrigin?: string } {
  if (isFit(state)) return {};
  return {
    transform: `translate(${state.x}px, ${state.y}px) scale(${state.scale})`,
    transformOrigin: 'center center',
  };
}

/** Facteur d'un cran de molette — sens naturel : vers le haut = plus près. */
export const wheelFactor = (deltaY: number): number => (deltaY < 0 ? 1.15 : 1 / 1.15);

/** Déplacement au-delà duquel un glissement n'est plus un clic (lecture/pause). */
export const PAN_CLICK_SLOP = 4;
