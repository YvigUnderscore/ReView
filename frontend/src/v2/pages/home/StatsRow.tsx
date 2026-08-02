// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { FolderKanban, Clapperboard, MessageSquare } from 'lucide-react';
import type { DashboardData } from './homeTypes';
import { useT, type MessageKey } from '../../i18n';

/** Compteurs « mes projets » — accents cyan (primaire), magenta (accent2), info. */
/** Traducteur passé à la table, recalculée à chaque rendu. */
type Tr = (key: MessageKey) => string;

const cards = (t: Tr) =>
  [
    { key: 'projects', label: t('nav.projects'), icon: FolderKanban, cls: 'bg-primary/10 text-primary' },
    {
      key: 'publishedMedia',
      label: t('home.mediaInReview'),
      icon: Clapperboard,
      cls: 'bg-accent2/10 text-accent2',
    },
    { key: 'comments', label: t('comments.filter.all'), icon: MessageSquare, cls: 'bg-info/10 text-info' },
  ] as const;

export default function StatsRow({ stats }: { stats: DashboardData['stats'] }) {
  const t = useT();
  return (
    <div className="grid grid-cols-3 gap-3">
      {cards(t).map(({ key, label, icon: Icon, cls }) => (
        <div key={key} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${cls}`}>
            <Icon size={19} />
          </span>
          <span className="min-w-0">
            <span className="block text-xl font-semibold leading-tight">{stats[key]}</span>
            <span className="block truncate text-xs text-muted-foreground">{label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
