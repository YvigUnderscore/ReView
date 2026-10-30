// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Line2 } from 'three/addons/lines/Line2.js';
import type { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/**
 * Classes for "thick lines" from Three (`Line2`), loaded **on demand**.
 *
 * A stroke of the 3D brush is a polyline whose thickness must stay constant **on screen**: this is
 * exactly what `LineMaterial` does with `worldUnits: false` (the thickness is in CSS pixels, the
 * view resolution being supplied to it on every frame). The `TubeGeometry` used before was in
 * world units: it grew when zooming in and vanished when zooming out, while the options bar
 * advertised "px".
 *
 * The import is dynamic and memoized: the splat viewer already loads three and Spark this way,
 * and a flat media has no reason to embed these three modules.
 */
export interface LineModules {
  Line2: typeof Line2;
  LineGeometry: typeof LineGeometry;
  LineMaterial: typeof LineMaterial;
}

let cached: Promise<LineModules> | null = null;

export function loadLineModules(): Promise<LineModules> {
  cached ??= Promise.all([
    import('three/addons/lines/Line2.js'),
    import('three/addons/lines/LineGeometry.js'),
    import('three/addons/lines/LineMaterial.js'),
  ]).then(([line, geometry, material]) => ({
    Line2: line.Line2,
    LineGeometry: geometry.LineGeometry,
    LineMaterial: material.LineMaterial,
  }));
  return cached;
}
