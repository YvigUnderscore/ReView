// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import PaintOverlay from './PaintOverlay';
import type { SplatPaintState } from './useSplatPaint';

/**
 * Calque de la brosse de surface, tel que les **deux** panes spatiaux le montent : il n'existe
 * que quand un des deux outils de brosse est armé et que la scène est prête. Le splat et le
 * modèle 3D posaient la même condition et les mêmes six props ; l'un des deux aurait fini par
 * dériver (et le viewer 3D n'avait rien du tout avant le lot 13).
 */
export default function SurfaceBrushLayer({
  paint,
  ready,
  getCanvas,
}: {
  paint: SplatPaintState;
  /** Scène montée : sans elle, le geste n'aurait aucune surface à interroger. */
  ready: boolean;
  /** Canvas de rendu — la molette lui est relayée pour conserver le zoom d'orbite. */
  getCanvas: () => HTMLElement | null;
}) {
  if (!paint.armed || !ready) return null;
  return (
    <PaintOverlay
      mode={paint.armed}
      color={paint.color}
      width={paint.width}
      getCanvas={getCanvas}
      gesture={paint.gesture}
      onErase={paint.eraseAt}
    />
  );
}
