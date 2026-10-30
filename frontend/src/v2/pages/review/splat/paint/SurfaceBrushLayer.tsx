// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import PaintOverlay from './PaintOverlay';
import type { SplatPaintState } from './useSplatPaint';

/**
 * Layer of the surface brush, as **both** spatial panes mount it: it only exists while one of the
 * two brush tools is armed and the scene is ready. The splat and the 3D model shared the same
 * condition and the same six props; one of the two would eventually have drifted (and the 3D
 * viewer had nothing at all before lot 13).
 */
export default function SurfaceBrushLayer({
  paint,
  ready,
  getCanvas,
}: {
  paint: SplatPaintState;
  /** Scene mounted: without it, the gesture would have no surface to query. */
  ready: boolean;
  /** Render canvas: the wheel is relayed to it to keep the orbit zoom. */
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
