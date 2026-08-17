// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, useLocation } from 'react-router-dom';
import { History } from 'lucide-react';
import { useRecents } from '../stores/useRecents';
import { useT } from '../i18n';

/**
 * Section « Récents » de la sidebar (10.A4) : les dernières entités visitées
 * (localStorage via useRecents), hors page courante.
 */
export default function SidebarRecents() {
  const t = useT();
  const recents = useRecents((s) => s.recents);
  const { pathname, search } = useLocation();
  const here = pathname + search;
  const visible = recents.filter((r) => r.to !== here);

  if (visible.length === 0) return null;

  return (
    <div className="pt-3">
      <div className="flex items-center gap-2 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <History size={13} /> {t('shell.recents')}
      </div>
      <div className="space-y-0.5">
        {visible.map((r) => (
          <Link
            key={r.key}
            to={r.to}
            title={r.sublabel ? `${r.label} — ${r.sublabel}` : r.label}
            className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="truncate">{r.label}</span>
            {r.sublabel && (
              <span className="ml-auto shrink-0 max-w-[40%] truncate text-2xs text-muted-foreground/70">
                {r.sublabel}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
