// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Line2 } from 'three/addons/lines/Line2.js';
import type { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/**
 * Classes de « lignes épaisses » de Three (`Line2`), chargées **à la demande**.
 *
 * Un trait de la brosse 3D est une polyligne dont l'épaisseur doit rester constante **à
 * l'écran** : c'est exactement ce que fait `LineMaterial` avec `worldUnits: false` (l'épaisseur
 * est en pixels CSS, la résolution de la vue lui étant donnée à chaque image). Le tube
 * `TubeGeometry` qu'on employait avant était en unités monde — il grossissait au zoom avant et
 * disparaissait au zoom arrière, alors que la barre d'options annonçait des « px ».
 *
 * L'import est dynamique et mémorisé : le viewer splat charge déjà three et Spark de cette
 * façon, et un média plat n'a aucune raison d'embarquer ces trois modules.
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
