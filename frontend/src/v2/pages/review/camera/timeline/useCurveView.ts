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

/** Fenêtre temporelle par défaut : toute l'animation, avec 10 % d'air et un plancher de 3 s. */
const autoTimeRange = (playDuration: number): TimeRange => ({
  t0: 0,
  t1: Math.max(playDuration * 1.1, 3000),
});

/**
 * Fenêtre de vue du curve editor (Phase 50, lot 7) : **deux axes**, chacun automatique jusqu'au
 * premier geste de l'utilisateur, puis figé sur son override.
 *
 * L'axe des valeurs était jusqu'ici recalé en permanence sur toutes les clés visibles : impossible
 * de regarder de près une courbe, la vue se recadrait à chaque édition. Il se zoome et se déplace
 * maintenant comme l'axe du temps, et le recadrage reste offert à la demande (tout, ou la
 * sélection). Les gestes ne sont pas mémoïsés : ils dépendent de la fenêtre courante, qui change
 * à chaque rendu du tiroir.
 */
export function useCurveView(opts: {
  anim: CameraAnimV2;
  /** Canaux dessinés — bornes automatiques de l'axe des valeurs. */
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
    /** Zoom horizontal au pivot temporel (molette). */
    zoomAt: (pivotT: number, factor: number) => setTime(zoomTime(timeView, pivotT, factor)),
    /** Zoom vertical au pivot de valeur (Ctrl+molette). */
    zoomValueAt: (pivotV: number, factor: number) => setValue(zoomValue(valueView, pivotV, factor)),
    /** Pan des deux axes (bouton du milieu ; Maj+molette ne décale que le temps). */
    panBy: (deltaMs: number, deltaV = 0) => {
      if (deltaMs) setTime(panTime(timeView, deltaMs));
      if (deltaV) setValue(panValue(valueView, deltaV));
    },
    /** Recadre les deux axes sur l'animation entière (bouton « ajuster » — état d'origine). */
    fitAll: () => {
      setTime(null);
      setValue(null);
    },
    /**
     * Recadre les deux axes sur un lot de clés (sélection). Une clé seule n'a pas d'étendue : on
     * lui laisse une seconde de part et d'autre, et l'air vertical de `fitValueRange`.
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
    /** Recadre le seul axe des valeurs sur une série (une courbe, ou les courbes visibles). */
    fitValues: (values: number[]) => {
      if (values.length) setValue(fitValueRange(values));
    },
  };
}
