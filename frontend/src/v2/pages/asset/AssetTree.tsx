// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileStack, Folder, FolderOpen } from 'lucide-react';
import { reviewPath } from '../../lib/slug';
import EmptyState from '../../components/ui/empty-state';
import type { AssetTreeTask, AssetTreeVersion, DepartmentGroup } from '../../types/api';
import { useT } from '../../i18n';

/**
 * L'asset vu comme un dossier (Phase 45) : départements dans l'ordre du pipe → tâches →
 * versions → médias.
 *
 * Tout est déplié d'office : un asset traverse deux à quatre départements, et ouvrir sa
 * page pour n'y voir que des dossiers fermés donnerait la même impression de vide que
 * l'écran corrigé ici. Le pli est mémorisé par département, à la main de l'utilisateur.
 */
export default function AssetTree({ groups }: { groups: DepartmentGroup<AssetTreeTask>[] }) {
  const t = useT();
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const idOf = (g: DepartmentGroup<AssetTreeTask>) => g.key ?? '__none__';
  const toggle = (id: string) => setFolded((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }));

  if (groups.length === 0)
    return (
      <EmptyState
        compact
        icon={FileStack}
        title={t('asset.tree.empty.title')}
        description={t('asset.tree.empty.description')}
      />
    );

  return (
    <div className="space-y-1.5">
      {groups.map((group) => {
        const id = idOf(group);
        const open = !folded[id];
        const versionCount = group.items.reduce((n, task) => n + task.versions.length, 0);
        return (
          <div key={id} className="rounded-md border border-border bg-card">
            <button onClick={() => toggle(id)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
              {open ? (
                <ChevronDown size={14} className="text-muted-foreground" />
              ) : (
                <ChevronRight size={14} className="text-muted-foreground" />
              )}
              {open ? (
                <FolderOpen size={15} className="text-primary" />
              ) : (
                <Folder size={15} className="text-muted-foreground" />
              )}
              <span className="text-sm font-medium">{group.name || t('pipeline.dept.none')}</span>
              <span className="text-xs text-muted-foreground">
                {t('asset.tree.taskCount', { count: group.items.length })} ·{' '}
                {t('asset.tree.versionCount', { count: versionCount })}
              </span>
            </button>
            {open && (
              <div className="space-y-2 border-t border-border px-3 py-2">
                {group.items.map((task) => (
                  <TaskRow key={task.id ?? 'loose'} task={task} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TaskRow({ task }: { task: AssetTreeTask }) {
  const t = useT();
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        {task.id === null ? (
          <span className="text-xs font-medium text-muted-foreground">{t('asset.tree.looseVersions')}</span>
        ) : (
          <Link to={`/tasks/${task.id}`} className="text-xs font-medium hover:text-primary">
            {task.name}
          </Link>
        )}
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{task.type}</span>
      </div>
      {task.versions.length === 0 ? (
        <p className="pl-2 text-xs text-muted-foreground">{t('asset.tree.noVersion')}</p>
      ) : (
        <ul className="space-y-1 pl-2">
          {task.versions.map((v) => (
            <VersionRow key={v.id} version={v} />
          ))}
        </ul>
      )}
    </div>
  );
}

function VersionRow({ version }: { version: AssetTreeVersion }) {
  const t = useT();
  return (
    <li className="flex flex-wrap items-center gap-2 rounded border border-border/60 bg-background px-2 py-1">
      <span className="text-xs font-medium">{version.name}</span>
      {!version.published && (
        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {t('media.draft')}
        </span>
      )}
      {version.reviewStatus && (
        <span
          className="rounded px-1.5 py-0.5 text-[10px] text-white"
          style={{ backgroundColor: version.reviewStatus.color }}
        >
          {version.reviewStatus.name}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground">
        {new Date(version.createdAt).toLocaleDateString()}
      </span>
      <div className="ml-auto flex items-center gap-1">
        {version.media.map((m) => (
          <Link
            key={m.id}
            to={reviewPath(m)}
            title={m.originalName}
            className="flex h-8 w-12 items-center justify-center overflow-hidden rounded border border-border hover:border-primary"
          >
            {m.thumbnailUrl ? (
              <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-[9px] text-muted-foreground">{m.kind}</span>
            )}
          </Link>
        ))}
      </div>
    </li>
  );
}
