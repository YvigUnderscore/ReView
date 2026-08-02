// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { Play, ListTodo, ArrowRight } from 'lucide-react';
import { useRecents, type RecentEntry } from '../stores/useRecents';
import { useT } from '../i18n';

/**
 * Carte « Reprendre où j'en étais » (10.A5) : en haut de ProjectsPage,
 * le dernier média en review et la dernière tâche ouverte (useRecents).
 * Un clic → retour direct à l'URL exacte mémorisée.
 */

function ResumeLink({ entry, icon, kind }: { entry: RecentEntry; icon: React.ReactNode; kind: string }) {
  return (
    <Link
      to={entry.to}
      className="group flex min-w-0 flex-1 items-center gap-3 rounded-md border border-border bg-card px-4 py-3 transition-colors hover:border-primary/50 hover:bg-secondary/40"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{kind}</span>
        <span className="block truncate text-sm font-medium">
          {entry.label}
          {entry.sublabel && (
            <span className="ml-2 font-normal text-muted-foreground">· {entry.sublabel}</span>
          )}
        </span>
      </span>
      <ArrowRight
        size={16}
        className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
      />
    </Link>
  );
}

export default function ResumeCard() {
  const t = useT();
  const recents = useRecents((s) => s.recents);
  const lastMedia = recents.find((r) => r.type === 'media');
  const lastTask = recents.find((r) => r.type === 'task');

  if (!lastMedia && !lastTask) return null;

  return (
    <div className="mb-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('shell.resume')}
      </p>
      <div className="flex flex-wrap gap-3">
        {lastMedia && <ResumeLink entry={lastMedia} icon={<Play size={16} />} kind="Dernière review" />}
        {lastTask && <ResumeLink entry={lastTask} icon={<ListTodo size={16} />} kind="Dernière tâche" />}
      </div>
    </div>
  );
}
