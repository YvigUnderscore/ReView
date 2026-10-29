// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useId, useMemo, useState, type RefObject } from 'react';
import {
  commonZone,
  containBox,
  useCompareFitPublish,
  useCompareFitZone,
  type Size,
} from '../compare/compareFit';

/** Display box of the media (pixels) — the annotation overlay shares exactly the same box. */
export type FitBox = Size;

/**
 * "Contain" fit computed by hand: the media fills all the available space, even at low resolution,
 * and the annotation overlay can align itself on the same box.
 *
 * `remeasureKey` forces a new measurement when the container size changes without the container
 * itself changing (entering/leaving fullscreen): without it, the video kept its previous size,
 * tiny in the middle of the black screen.
 *
 * In a comparison (`CompareFitProvider`), the measured zone is **registered** and the media fits
 * within the zone common to all panes: two media of different resolutions are then displayed at
 * the same size, even though the master pane (timeline + transport under the image) and the B
 * panes (header) never have the same available height.
 *
 * `grouped` false takes the pane out of this sharing: a pane shown alone in fullscreen no longer
 * has to fit within the zone of the others, which stay at their layout size behind it.
 */
export function useFitBox(
  containerRef: RefObject<HTMLElement | null>,
  remeasureKey?: unknown,
  grouped = true,
): { box: FitBox | null; aspect: number | null; setAspect: (aspect: number) => void } {
  const [aspect, setAspect] = useState<number | null>(null);
  const [zone, setZone] = useState<Size | null>(null);
  const publish = useCompareFitPublish();
  const groupZone = useCompareFitZone();
  const paneId = useId();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      // Same measurement: keep the original object, otherwise every observer tick would
      // re-render the player for nothing.
      setZone((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, remeasureKey]);

  // Registration in the comparison group — removed on pane unmount, otherwise the zone of a
  // closed pane would keep shrinking the others.
  useEffect(() => {
    if (!publish || !zone || !grouped) return;
    publish(paneId, zone);
    return () => publish(paneId, null);
  }, [publish, paneId, zone, grouped]);

  const box = useMemo(() => {
    // The common zone counts this pane's registration, but not yet on the first render:
    // intersect it with the local measurement so as never to overflow its own zone.
    const z = commonZone([zone, grouped ? groupZone : null].filter((s): s is Size => s != null));
    if (!z || !aspect) return null;
    return containBox(z, aspect);
  }, [zone, groupZone, grouped, aspect]);

  return { box, aspect, setAspect };
}
