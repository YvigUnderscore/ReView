// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { isEditable } from '../../../lib/shortcuts';

/** The two view commands of the flat viewers — the ones the rail names `fit` and `reset`. */
export interface ViewCommands {
  /** Fit to screen (`F`). */
  fit: () => void;
  /** Actual size, one media pixel per screen pixel (`H`). */
  oneToOne: () => void;
}

/**
 * `F` / `H` on the two flat viewers — the counterpart of `useFrameShortcuts`, which provides the
 * same service in 3D and splat.
 *
 * Both view actions were **declared** in `chrome/tools.ts` (`action.fitMedia`,
 * `action.resetMedia`) and wired nowhere: on an image as on a video, the two letters did nothing.
 * They also replace `0` and `1`, which the player's zoom listened to: `1` both adjusted the scale
 * **and** switched to the first mode of the toggle, two responses for one keystroke.
 *
 * `null` disarms the hook — a comparison pane must not respond to these keys in addition to the
 * main viewer.
 */
export function useViewShortcuts(commands: ViewCommands | null): void {
  // Mirror: the functions change identity on every viewer render, the subscription does not.
  const ref = useRef(commands);
  useEffect(() => {
    ref.current = commands;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = ref.current;
      if (!cmd) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'f') cmd.fit();
      else if (key === 'h') cmd.oneToOne();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
