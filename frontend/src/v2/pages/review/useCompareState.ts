// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import type { WipeShared } from './useWipe';

/** Max number of B panes (34.D): 3 slaves + the master = full 2×2 grid. */
export const MAX_COMPARE = 3;

/** A/B comparison modes: side by side, wipe (bar), amplified difference (34.E). */
export type CompareMode = 'side' | 'wipe' | 'diff';

/**
 * Comparison lifted into the orchestrator (feedback 33 + 34.D): list of B media (1 = classic A/B,
 * side by side or wipe; 2-3 = synchronized video 2×2 grid), mode and wipe bar. The first id remains
 * the comparison replicated in the live session.
 */
export function useCompareState() {
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [compareMode, setCompareMode] = useState<CompareMode>('side');
  const [wipePos, setWipePos] = useState(0.5);
  const [wipeAngle, setWipeAngle] = useState(0);

  /** Simple A/B compat (live, image selection): replaces the whole selection. */
  const setCompareId = (id: number | null) => setCompareIds(id == null ? [] : [id]);
  const addCompareId = (id: number) =>
    setCompareIds((ids) => (ids.includes(id) || ids.length >= MAX_COMPARE ? ids : [...ids, id]));
  const removeCompareId = (id: number) => setCompareIds((ids) => ids.filter((i) => i !== id));

  /** Applies a live sync (viewer side). */
  const applyWipe = (pos: number, angle: number) => {
    setWipePos(pos);
    setWipeAngle(angle);
  };

  /** Shared state consumed by the wipe overlays; `onGrab` = live takeover. */
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
