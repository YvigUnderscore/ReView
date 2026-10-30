// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { isEditable } from '@/v2/lib/shortcuts';

/**
 * Framing shortcuts shared by the 3D/splat viewers (Phase 17): `F` frames the selection or the
 * object, `H` restores the original view. Inert during a flight (right click + ZQSD), in input
 * fields, in dialogs, or while a modifier is held — same guard as the splat viewer.
 */
export function useFrameShortcuts(opts: {
  active: boolean;
  isFlying: () => boolean;
  onFrame: () => void;
  onHome: () => void;
}) {
  const { active, isFlying, onFrame, onHome } = opts;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return;
      if (isFlying() || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f') {
        e.preventDefault();
        onFrame();
      } else if (k === 'h') {
        e.preventDefault();
        onHome();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, isFlying, onFrame, onHome]);
}
