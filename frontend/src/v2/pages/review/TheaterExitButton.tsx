// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Minimize2 } from 'lucide-react';
import { useT } from '../../i18n';

/**
 * Exit from theater mode — the only chrome left visible when the viewer fills the screen.
 * Extracted from `ReviewPage` (orchestrator at its 300-line budget).
 */
export default function TheaterExitButton({ onExit }: { onExit: () => void }) {
  const t = useT();
  return (
    <button
      onClick={onExit}
      title={t('review.exitTheatre')}
      className="absolute right-4 top-4 z-50 rounded-md border border-border bg-card/80 p-1.5 text-muted-foreground backdrop-blur hover:bg-secondary hover:text-foreground"
    >
      <Minimize2 size={16} />
    </button>
  );
}
