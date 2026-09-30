// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useRef, type MutableRefObject } from 'react';
import type { ImageView, ImageViewApi } from '../../components/ImageReviewViewer';

/** Égalité de vues normalisées (zoom + centre en fraction d'image) à epsilon près. */
export const viewsEqual = (a: ImageView | null, b: ImageView | null): boolean =>
  !!a &&
  !!b &&
  Math.abs(a.scale - b.scale) < 1e-4 &&
  Math.abs(a.cx - b.cx) < 1e-4 &&
  Math.abs(a.cy - b.cy) < 1e-4;

type Apply = ((v: ImageView) => void) | null;

/**
 * Relais de vue entre panes A/B (34.D), pur (la partie React est dans le hook) :
 * mémorise la dernière vue propagée pour couper la boucle A→B→A (l'application chez
 * l'autre pane ré-émet la même vue, ignorée à epsilon près). La **première** émission
 * du pane B (son fit au montage) ne remonte pas au maître : B adopte la vue courante.
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
 * Zoom/pan répliqué entre les panes A et B de la comparaison image (34.D) : chaque
 * viewer émet sa vue (`onViewChange`), le relais l'applique à l'autre. Bidirectionnel —
 * manipuler le pane B recadre aussi le maître.
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
