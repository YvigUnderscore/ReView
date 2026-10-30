// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef, type MutableRefObject } from 'react';
import type { ImageView, ImageViewApi } from '../../components/ImageReviewViewer';

/** Equality of normalized views (zoom + center as a fraction of the image) within epsilon. */
export const viewsEqual = (a: ImageView | null, b: ImageView | null): boolean =>
  !!a &&
  !!b &&
  Math.abs(a.scale - b.scale) < 1e-4 &&
  Math.abs(a.cx - b.cx) < 1e-4 &&
  Math.abs(a.cy - b.cy) < 1e-4;

type Apply = ((v: ImageView) => void) | null;

/**
 * View relay between A/B panes (34.D), pure (the React part is in the hook): remembers the last view
 * propagated to cut the A→B→A loop (applying it on the other pane re-emits the same view, ignored
 * within epsilon). The **first** emission from pane B (its fit on mount) does not go back up to the
 * master: B adopts the current view.
 */
export function createViewSync() {
  let last: ImageView | null = null;
  let slaveSeen = false;
  const push = (v: ImageView, apply: Apply): boolean => {
    if (viewsEqual(v, last)) return false;
    last = v;
    apply?.(v);
    return true;
  };
  return {
    fromMaster: (v: ImageView, applyToSlave: Apply) => push(v, applyToSlave),
    fromSlave: (v: ImageView, applyToMaster: Apply, applyToSlave: Apply) => {
      if (!slaveSeen) {
        slaveSeen = true;
        if (last && !viewsEqual(v, last)) applyToSlave?.(last);
        return false;
      }
      return push(v, applyToMaster);
    },
  };
}

/**
 * Zoom/pan replicated between panes A and B of the image comparison (34.D): each viewer emits its view
 * (`onViewChange`), and the relay applies it to the other. Bidirectional — manipulating pane B also
 * reframes the master.
 */
export function useImageCompareSync(masterApiRef?: MutableRefObject<ImageViewApi | null>) {
  const slaveApiRef = useRef<ImageViewApi | null>(null);
  const sync = useRef(createViewSync()).current;
  const onMasterView = useCallback(
    (v: ImageView) => sync.fromMaster(v, (vv) => slaveApiRef.current?.apply(vv)),
    [sync],
  );
  const onSlaveView = useCallback(
    (v: ImageView) =>
      sync.fromSlave(
        v,
        (vv) => masterApiRef?.current?.apply(vv),
        (vv) => slaveApiRef.current?.apply(vv),
      ),
    [sync, masterApiRef],
  );
  return { slaveApiRef, onMasterView, onSlaveView };
}
