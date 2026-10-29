// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { isEditable } from '../../lib/shortcuts';

/**
 * `H` returns to the original view, the only shortcut offered to a share viewer.
 *
 * The guest has neither palette nor menu: the "simple UI" rule wants an action to go through a
 * shortcut rather than a button, and right-click is already taken by free fly on spatial
 * viewers. Inert while a comment is being typed: writing "hauteur" must not reframe the scene.
 */
export function useHomeViewShortcut(homeView: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() !== 'h' || isEditable(e.target)) return;
      e.preventDefault();
      homeView();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [homeView, enabled]);
}
