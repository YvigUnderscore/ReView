// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { shouldBlockNativeMenu, situationOf } from '../lib/contextTarget';

/**
 * Right-click guard (A3): replaces the former global menu.
 *
 * This component renders nothing: it only prevents the browser menu from appearing where
 * the application has nothing relevant to offer. The generic menu that opened
 * everywhere was removed: it served the same entries on a shot card, on a title
 * and on empty space, which helped nobody. The actions it still carried (copy the
 * page link, refresh, theme, shortcuts) joined the Ctrl+K palette, where they
 * are searchable and keyboard-accessible.
 *
 * The policy itself lives in `lib/contextTarget.ts`, tested in isolation.
 */
export default function ContextMenuGuard() {
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (shouldBlockNativeMenu(situationOf(event))) event.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, []);
  return null;
}
