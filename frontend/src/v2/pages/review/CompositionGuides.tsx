// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef } from 'react';
import { useGuides } from '../../stores/useGuides';
import GuideLayer from './guides/GuideLayer';
import { actionSafeRect, centerCrossSegments, thirdsLines, titleSafeRect } from './guides/guideGeometry';
import { guideDashArray } from './guides/guideStyle';
import { useGuideBox } from './guides/useGuideBox';

/**
 * Repères de composition (34.G) : tiers, croix centrale, safe areas action (90 %) et titre
 * (80 %) — SVG en surimpression du cadre du média (`pointer-events-none`), activés par le
 * menu clic droit de la review.
 *
 * Tout le style vient de `guides/guideStyle` (mêmes traits que le liseré du cadre de
 * livraison), la géométrie de `guides/guideGeometry` (croix carrée quel que soit l'aspect),
 * et l'épaisseur est compensée du zoom du lecteur : 1 px à l'écran, à toutes les échelles.
 */
export default function CompositionGuides() {
  const guides = useGuides((s) => s.guides);
  const ref = useRef<HTMLDivElement>(null);
  const on = guides.thirds || guides.center || guides.actionSafe || guides.titleSafe;
  const { w, h, scale } = useGuideBox(ref, on);
  if (!on) return null;

  const [crossH, crossV] = centerCrossSegments(w, h);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-20">
      <GuideLayer w={w} h={h} scale={scale} className="h-full w-full">
        {guides.thirds &&
          thirdsLines(w, h).map((l, i) => <line key={`third-${i}`} {...l} data-guide="thirds" />)}
        {guides.center && (
          <>
            <line {...crossH} data-guide="center" />
            <line {...crossV} data-guide="center" />
          </>
        )}
        {guides.actionSafe && <rect {...actionSafeRect(w, h)} data-guide="actionSafe" />}
        {/* Le repère titre se distingue par ses tirets, jamais par son épaisseur. */}
        {guides.titleSafe && (
          <rect {...titleSafeRect(w, h)} strokeDasharray={guideDashArray(scale)} data-guide="titleSafe" />
        )}
      </GuideLayer>
    </div>
  );
}
