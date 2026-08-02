// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import type { WipeShared } from './useWipe';

/** Nombre max de panes B (34.D) : 3 esclaves + le maître = grille 2×2 pleine. */
export const MAX_COMPARE = 3;

/** Modes de comparaison A/B : côte-à-côte, wipe (barre), différence amplifiée (34.E). */
export type CompareMode = 'side' | 'wipe' | 'diff';

/**
 * Comparaison hissée dans l'orchestrateur (retours 33 + 34.D) : liste des médias B
 * (1 = A/B classique côte-à-côte/wipe ; 2-3 = grille 2×2 vidéo synchronisée), mode et
 * barre de wipe. Le premier id reste la comparaison répliquée en session live.
 */
export function useCompareState() {
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [compareMode, setCompareMode] = useState<CompareMode>('side');
  const [wipePos, setWipePos] = useState(0.5);
  const [wipeAngle, setWipeAngle] = useState(0);

  /** Compat A/B simple (live, sélection image) : remplace toute la sélection. */
  const setCompareId = (id: number | null) => setCompareIds(id == null ? [] : [id]);
  const addCompareId = (id: number) =>
    setCompareIds((ids) => (ids.includes(id) || ids.length >= MAX_COMPARE ? ids : [...ids, id]));
  const removeCompareId = (id: number) => setCompareIds((ids) => ids.filter((i) => i !== id));

  /** Application d'une sync live (spectateur). */
  const applyWipe = (pos: number, angle: number) => {
    setWipePos(pos);
    setWipeAngle(angle);
  };

  /** État partagé consommé par les overlays de wipe ; `onGrab` = prise de main live. */
  const makeSharedWipe = (onGrab: () => void): WipeShared => ({
    pos: wipePos,
    angle: wipeAngle,
    setPos: setWipePos,
    setAngle: setWipeAngle,
    onGrab,
  });

  return {
    compareIds,
    compareId: compareIds[0] ?? null,
    setCompareId,
    addCompareId,
    removeCompareId,
    compareMode,
    setCompareMode,
    wipe: { pos: wipePos, angle: wipeAngle },
    applyWipe,
    makeSharedWipe,
  };
}
