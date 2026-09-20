// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CSSProperties } from 'react';
import CompositionGuides from '../CompositionGuides';
import type { FitBox } from '../zoom/useFitBox';

/**
 * Repères de composition posés dans un calque À PART, au-dessus de la comparaison A/B.
 *
 * Ils vivaient dans le calque média. Or ce calque porte la transformation du zoom, ce qui en
 * fait un contexte d'empilement : son `z-index` interne n'a plus cours à l'extérieur. La
 * surcouche de comparaison, frère rendu APRÈS lui, recouvrait donc tout — repères compris, qui
 * disparaissaient dès qu'on ouvrait un wipe ou une différence.
 *
 * D'où ce troisième calque, frère lui aussi, rendu en dernier : il rejoue la géométrie du
 * calque média (même boîte, même transformation, même centrage) pour que les repères tombent
 * sur l'image et non sur la zone du lecteur, et il ne capte aucun pointeur.
 */
export default function ZoomedGuidesLayer({
  box,
  zoomStyle,
}: {
  box: FitBox | null;
  zoomStyle: CSSProperties;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div
        className="relative"
        style={{
          ...(box ? { width: box.w, height: box.h } : { maxWidth: '100%', maxHeight: '100%' }),
          ...zoomStyle,
        }}
      >
        <CompositionGuides />
      </div>
    </div>
  );
}
