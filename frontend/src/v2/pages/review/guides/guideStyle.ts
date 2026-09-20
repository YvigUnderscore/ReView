// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Langage visuel **unique** des repères de review : tiers, croix centrale, safe areas et
 * liseré du cadre de livraison (letterbox) partagent d'ici leur trait, leur couleur et leur
 * ombre. Les valeurs vivaient jusqu'ici en dur dans chaque JSX — d'où des épaisseurs et des
 * couleurs qui divergeaient d'un repère à l'autre.
 *
 * Toutes les longueurs sont exprimées en **pixels écran** : les repères sont dessinés dans
 * un SVG dont le `viewBox` est en pixels CSS de sa propre boîte, et les helpers divisent par
 * l'échelle du calque zoomé — un trait reste donc à 1 px à l'écran, que le lecteur soit
 * ajusté ou à 16×.
 */

/** Épaisseur de tous les traits de repère, en pixels écran. */
export const GUIDE_STROKE_PX = 1;

/**
 * Blanc de mire. **Dérogation assumée aux tokens du thème** : un repère de cadrage est une
 * convention de mire (comme une charte ou une amorce), pas une couleur d'interface. Il doit
 * rester identique en thème clair comme en sombre, au-dessus d'un média dont on ne connaît
 * pas la luminosité ; sa lisibilité vient de l'ombre portée, pas d'un token de thème.
 */
export const GUIDE_COLOR = '#ffffff';

/** Opacité du trait : blanc franc mais non agressif au-dessus de l'image. */
export const GUIDE_OPACITY = 0.8;

/** Ombre portée — c'est elle qui détache le trait d'un fond clair. */
export const GUIDE_SHADOW_COLOR = '#000000';
export const GUIDE_SHADOW_OPACITY = 0.6;
/** Écart-type du flou, en pixels écran. */
export const GUIDE_SHADOW_BLUR_PX = 0.8;
/** Décalage vertical de l'ombre, en pixels écran. */
export const GUIDE_SHADOW_DY_PX = 0.5;

/** Tirets (repère titre), en pixels écran : trait puis vide. */
export const GUIDE_DASH_PX: readonly [number, number] = [6, 4];

/** Voile des zones hors cadre de livraison (letterbox). */
export const GUIDE_SCRIM_OPACITY = 0.4;

/** Safe area « action » : 90 % du cadre. */
export const ACTION_SAFE_RATIO = 0.9;
/** Safe area « titre » : 80 % du cadre. */
export const TITLE_SAFE_RATIO = 0.8;
/** Demi-longueur d'une branche de la croix centrale, en fraction du plus petit côté. */
export const CENTER_CROSS_RATIO = 0.04;

/** Échelle du calque zoomé, ramenée à une valeur exploitable (garde-fou). */
export const guideScale = (scale: number): number => (Number.isFinite(scale) && scale > 0 ? scale : 1);

/** Épaisseur en unités du `viewBox` (pixels CSS) pour obtenir `GUIDE_STROKE_PX` à l'écran. */
export const guideStrokeWidth = (scale: number): number => GUIDE_STROKE_PX / guideScale(scale);

/** Motif de tirets compensé du zoom — même longueur apparente à toutes les échelles. */
export const guideDashArray = (scale: number): string =>
  GUIDE_DASH_PX.map((v) => v / guideScale(scale)).join(' ');

/** Flou de l'ombre, compensé du zoom. */
export const guideShadowBlur = (scale: number): number => GUIDE_SHADOW_BLUR_PX / guideScale(scale);

/** Décalage de l'ombre, compensé du zoom. */
export const guideShadowDy = (scale: number): number => GUIDE_SHADOW_DY_PX / guideScale(scale);

/**
 * Attributs de trait posés **une seule fois**, sur le groupe qui porte tous les repères :
 * `stroke`, `stroke-width` et `stroke-opacity` sont hérités par les enfants, qui ne portent
 * donc que leur géométrie. C'est le point unique qui garantit l'uniformité.
 */
export interface GuideStrokeProps {
  fill: 'none';
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  strokeLinecap: 'butt';
}

export const guideStrokeProps = (scale: number): GuideStrokeProps => ({
  fill: 'none',
  stroke: GUIDE_COLOR,
  strokeWidth: guideStrokeWidth(scale),
  strokeOpacity: GUIDE_OPACITY,
  strokeLinecap: 'butt',
});
