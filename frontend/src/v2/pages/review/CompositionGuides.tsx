// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useGuides } from '../../stores/useGuides';

/**
 * Guides de composition (34.G) : tiers, croix centrale, safe areas action (90 %) et
 * titre (80 %) — SVG en surimpression du cadre du média (pointer-events-none), activés
 * par le menu clic droit de la review. Traits fins constants (non-scaling-stroke).
 */
export default function CompositionGuides() {
  const guides = useGuides((s) => s.guides);
  if (!guides.thirds && !guides.center && !guides.actionSafe && !guides.titleSafe) return null;
  const stroke = { vectorEffect: 'non-scaling-stroke' as const, strokeWidth: 1 };
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-20 h-full w-full text-primary/60"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      {guides.thirds && (
        <g stroke="currentColor" {...stroke}>
          <line x1="33.333" y1="0" x2="33.333" y2="100" />
          <line x1="66.667" y1="0" x2="66.667" y2="100" />
          <line x1="0" y1="33.333" x2="100" y2="33.333" />
          <line x1="0" y1="66.667" x2="100" y2="66.667" />
        </g>
      )}
      {guides.center && (
        <g stroke="currentColor" {...stroke}>
          <line x1="46" y1="50" x2="54" y2="50" />
          <line x1="50" y1="46" x2="50" y2="54" />
        </g>
      )}
      {guides.actionSafe && (
        <rect x="5" y="5" width="90" height="90" fill="none" stroke="currentColor" {...stroke} />
      )}
      {guides.titleSafe && (
        <rect
          x="10"
          y="10"
          width="80"
          height="80"
          fill="none"
          stroke="currentColor"
          strokeDasharray="4 3"
          {...stroke}
        />
      )}
    </svg>
  );
}
