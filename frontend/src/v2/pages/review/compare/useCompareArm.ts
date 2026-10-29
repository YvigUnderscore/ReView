// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { DEFAULT_MODE, type ModeId } from '../chrome/modes';
import type { CompareMode } from '../useCompareState';

/**
 * Links the "Compare" mode of the toggle to the comparison state.
 *
 * The two used to live side by side without talking to each other: arming the segment chose
 * no B media, so the wipe bar never appeared. Everything goes through `useCompareState`, so
 * that a viewer of a live session sees the same thing as the driver.
 *
 * Three rules, and their converses:
 *   1. entering the comparison arms the wipe and takes the first comparable media;
 *   2. leaving it closes the comparison;
 *   3. a B chosen elsewhere (video header, live session) arms the mode; closing it leaves it.
 */
export function useCompareArm({
  mode,
  onMode,
  hasB,
  firstB,
  onSetB,
  onClear,
  onCompareMode,
}: {
  mode: ModeId;
  onMode: (mode: ModeId) => void;
  hasB: boolean;
  /** First known comparable media; null until it is loaded. */
  firstB: number | null;
  onSetB: (mediaId: number) => void;
  onClear: () => void;
  onCompareMode: (mode: CompareMode) => void;
}) {
  const prevMode = useRef(mode);
  const hadB = useRef(hasB);
  const picked = useRef(false);
  // The mode has just been armed by rule 3, not by the user: the video that ticks two versions
  // at once wants its 2×2 grid, not a wipe forced on it on the way.
  const fromB = useRef(false);

  useEffect(() => {
    const was = prevMode.current;
    if (was === mode) return;
    prevMode.current = mode;
    if (mode === 'compare') {
      if (!fromB.current) onCompareMode('wipe');
      fromB.current = false;
    } else if (was === 'compare' && hasB) onClear();
  }, [mode, hasB, onCompareMode, onClear]);

  useEffect(() => {
    const had = hadB.current;
    hadB.current = hasB;
    if (hasB && !had && mode !== 'compare') {
      fromB.current = true;
      onMode('compare');
    } else if (!hasB && had && mode === 'compare') onMode(DEFAULT_MODE);
  }, [hasB, mode, onMode]);

  // Armed without B: the first comparable media is taken by default, once. Without it the wipe
  // bar would have nothing to reveal. `picked` prevents taking it again after a close.
  useEffect(() => {
    if (mode !== 'compare') {
      picked.current = false;
      return;
    }
    if (hasB || picked.current || firstB == null) return;
    picked.current = true;
    onSetB(firstB);
  }, [mode, hasB, firstB, onSetB]);
}
