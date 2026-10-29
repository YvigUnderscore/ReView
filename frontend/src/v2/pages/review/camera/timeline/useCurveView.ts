// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import type { CameraAnimV2, ChannelId, KeyRef } from '../channels/model';
import {
  fitValueRange,
  panTime,
  panValue,
  zoomTime,
  zoomValue,
  type TimeView,
  type ValueView,
} from './viewTransform';

type TimeRange = { t0: number; t1: number };
type ValueRange = { v0: number; v1: number };

/** Default time window: the whole animation, with 10% room and a 3 s minimum. */
const autoTimeRange = (playDuration: number): TimeRange => ({
  t0: 0,
  t1: Math.max(playDuration * 1.1, 3000),
});

/**
 * View window of the curve editor (Phase 50, batch 7): **two axes**, each automatic until the
 * user's first gesture, then frozen at its override.
 *
 * The value axis used to be constantly refitted to all visible keys: impossible to look closely
 * at a curve, the view re-framed on every edit. It now zooms and pans like the time axis, and
 * refitting stays available on request (everything, or the selection). The gestures are not
 * memoized: they depend on the current window, which changes on every drawer render.
 */
export function useCurveView(opts: {
  anim: CameraAnimV2;
  /** Drawn channels — automatic bounds of the value axis. */
  visible: ReadonlySet<ChannelId>;
  playDuration: number;
  width: number;
  height: number;
}) {
  const { anim, visible, playDuration, width, height } = opts;
  const [time, setTime] = useState<TimeRange | null>(null);
  const [value, setValue] = useState<ValueRange | null>(null);

  const autoValue = useMemo(() => {
    const values: number[] = [];
    for (const id of visible) for (const k of anim.channels[id]?.keys ?? []) values.push(k.v);
    return fitValueRange(values);
  }, [visible, anim]);

  const timeView: TimeView = { ...(time ?? autoTimeRange(playDuration)), width };
  const valueView: ValueView = { ...(value ?? autoValue), height };

  return {
    timeView,
    valueView,
    /** Horizontal zoom around the time pivot (wheel). */
    zoomAt: (pivotT: number, factor: number) => setTime(zoomTime(timeView, pivotT, factor)),
    /** Vertical zoom around the value pivot (Ctrl+wheel). */
    zoomValueAt: (pivotV: number, factor: number) => setValue(zoomValue(valueView, pivotV, factor)),
    /** Pan on both axes (middle button; Shift+wheel only shifts the time). */
    panBy: (deltaMs: number, deltaV = 0) => {
      if (deltaMs) setTime(panTime(timeView, deltaMs));
      if (deltaV) setValue(panValue(valueView, deltaV));
    },
    /** Refits both axes to the whole animation ("fit" button — original state). */
    fitAll: () => {
      setTime(null);
      setValue(null);
    },
    /**
     * Refits both axes to a batch of keys (selection). A single key has no extent: it is given one
     * second on either side, and the vertical room of `fitValueRange`.
     */
    fitKeys: (refs: readonly KeyRef[]) => {
      const keys = refs.map((r) => anim.channels[r.channel]?.keys[r.index]).filter((k) => k != null);
      if (!keys.length) return;
      const times = keys.map((k) => k.t);
      const t0 = Math.min(...times);
      const t1 = Math.max(...times);
      const pad = Math.max((t1 - t0) * 0.1, 1000);
      setTime({ t0: Math.max(0, t0 - pad), t1: t1 + pad });
      setValue(fitValueRange(keys.map((k) => k.v)));
    },
    /** Refits only the value axis to a series (one curve, or the visible curves). */
    fitValues: (values: number[]) => {
      if (values.length) setValue(fitValueRange(values));
    },
  };
}
