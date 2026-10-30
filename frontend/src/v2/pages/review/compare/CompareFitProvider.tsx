// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { PublishContext, ZoneContext, commonZone, type PublishZone, type Size } from './compareFit';

/**
 * **Shared** fitting of the comparison panes (side by side or as a 2×2 grid).
 *
 * Each pane measures its area and registers it here; all of them then fit their media into
 * the common area. Intended consequence: two media of different resolutions are displayed at
 * the **same size**, and each keeps its own aspect ratio. The fit is a "contain": it distorts
 * nothing, and the delivery frame and normalized annotations follow the box without changing
 * proportions.
 *
 * Outside a comparison, a single pane is registered: the common area is its own, nothing changes.
 */
export function CompareFitProvider({ children }: { children: ReactNode }) {
  const [zones, setZones] = useState<Record<string, Size>>({});

  const publish = useCallback<PublishZone>((id, size) => {
    setZones((prev) => {
      const known = prev[id];
      if (size == null) {
        if (!known) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      // Same measurement: return the original object, otherwise every observer tick would
      // re-render all panes for nothing.
      if (known && known.w === size.w && known.h === size.h) return prev;
      return { ...prev, [id]: size };
    });
  }, []);

  const zone = useMemo(() => commonZone(Object.values(zones)), [zones]);

  return (
    <PublishContext.Provider value={publish}>
      <ZoneContext.Provider value={zone}>{children}</ZoneContext.Provider>
    </PublishContext.Provider>
  );
}
