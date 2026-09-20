// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId, type CSSProperties, type ReactNode } from 'react';
import {
  GUIDE_SHADOW_COLOR,
  GUIDE_SHADOW_OPACITY,
  guideShadowBlur,
  guideShadowDy,
  guideStrokeProps,
} from './guideStyle';

/**
 * Calque SVG commun à **tous** les repères de review (composition et cadre de livraison) :
 * il pose le `viewBox` en pixels CSS de sa propre boîte (une unité = un pixel, mise à
 * l'échelle uniforme), l'ombre portée, et le seul groupe qui porte le trait. Les enfants
 * n'apportent que leur géométrie : ils héritent couleur, épaisseur et opacité, et ne peuvent
 * donc plus diverger.
 */
export default function GuideLayer({
  w,
  h,
  scale = 1,
  className,
  style,
  children,
}: {
  /** Largeur de la boîte, en pixels CSS (mise en page, hors zoom). */
  w: number;
  /** Hauteur de la boîte, en pixels CSS (mise en page, hors zoom). */
  h: number;
  /** Échelle de l'ancêtre transformé — les longueurs sont divisées par elle. */
  scale?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  // Identifiant unique par instance : deux lecteurs affichés côte à côte (multi-grille,
  // comparaison A/B) définiraient sinon deux filtres de même `id`, et le second reprendrait
  // le flou du premier — donc l'ombre calculée pour un autre zoom.
  // `useId` encadre son identifiant de ponctuation (`:r0:`, `«r0»` selon la version de React) :
  // on ne garde que l'alphanumérique, seul jeu sûr dans un `url(#…)`.
  const filterId = `review-guide-shadow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const blur = guideShadowBlur(scale);
  const dy = guideShadowDy(scale);
  const stroke = guideStrokeProps(scale);
  // Région du filtre en unités utilisateur : une bbox de hauteur nulle (un trait seul) rendrait
  // la région nulle, et le navigateur n'afficherait rien du tout.
  const margin = blur * 4 + dy + stroke.strokeWidth;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <filter
          id={filterId}
          filterUnits="userSpaceOnUse"
          x={-margin}
          y={-margin}
          width={w + margin * 2}
          height={h + margin * 2}
        >
          <feDropShadow
            dx={0}
            dy={dy}
            stdDeviation={blur}
            floodColor={GUIDE_SHADOW_COLOR}
            floodOpacity={GUIDE_SHADOW_OPACITY}
          />
        </filter>
      </defs>
      <g {...stroke} filter={`url(#${filterId})`}>
        {children}
      </g>
    </svg>
  );
}
