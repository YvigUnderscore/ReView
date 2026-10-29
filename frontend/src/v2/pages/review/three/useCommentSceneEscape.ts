// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';

/**
 * The scene proposed by a comment stays applied after a view movement (46.T): one can navigate the
 * modified scene, and Escape releases it — same key as returning to the idle tool, same "idle"
 * semantics.
 *
 * The keystroke is ignored during text entry: there Escape cancels the field, not the scene.
 * Extracted from `Model3DReview` (line budget).
 */
export function useCommentSceneEscape(active: boolean, release: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
      if (e.key === 'Escape') release();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, release]);
}
