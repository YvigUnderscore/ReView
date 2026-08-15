// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ExternalLink, FileStack, Layers } from 'lucide-react';
import { reviewPath } from '../../lib/slug';
import EmptyState from '../../components/ui/empty-state';
import PipelineStatusBadge from '../../components/shotgrid/PipelineStatusBadge';
import { useSgLinks } from '../../components/shotgrid/useSgLinks';
import { useT, intlLocale } from '../../i18n';
import { scheduleLabel } from './taskSchedule';
import type { AssetTreeTask, AssetTreeVersion, DepartmentGroup } from '../../types/api';

/**
 * Tâches d'un asset, en cartes.
 *
 * L'affichage précédent empilait départements, tâches, versions et médias dans une
 * seule colonne : sur un asset qui traverse quatre départements, la page devenait
 * illisible avant même d'avoir commencé à travailler. Ici, une carte par tâche donne
 * l'état d'un coup d'œil ; on entre dans une tâche pour en voir les versions, et on en
 * ressort. Un seul niveau à la fois.
 */
export default function AssetTaskCards({
  groups,
  projectId,
}: {
  groups: DepartmentGroup<AssetTreeTask>[];
  projectId: number;
}) {
  const t = useT();
  const [openTaskId, setOpenTaskId] = useState<number | 'loose' | null>(null);

  const allTasks = groups.flatMap((g) => g.items.map((task) => ({ task, group: g })));
  if (allTasks.length === 0)
    return (
      <EmptyState
        compact
        icon={FileStack}
        title={t('asset.tree.empty.title')}
        description={t('asset.tree.empty.description')}
      />
    );

  const opened = allTasks.find(({ task }) => (task.id ?? 'loose') === openTaskId);
  if (opened)
    return (
      <TaskVersions
        task={opened.task}
        department={opened.group.name}
        projectId={projectId}
        onBack={() => setOpenTaskId(null)}
      />
    );

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <section key={group.key ?? '__none__'}>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Layers size={13} />
            {group.name || t('pipeline.dept.none')}
            <span className="font-normal normal-case">
              {t('asset.tree.taskCount', { count: group.items.length })}
            </span>
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((task) => (
              <TaskCard
                key={task.id ?? 'loose'}
                task={task}
                projectId={projectId}
                onOpen={() => setOpenTaskId(task.id ?? 'loose')}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const formatDay = (value: string): string => (value ? new Date(value).toLocaleDateString(intlLocale()) : '—');

/** Fenêtre de travail d'une tâche, telle que la production l'a fixée. */
function TaskSchedule({ task }: { task: AssetTreeTask }) {
  const t = useT();
  const label = scheduleLabel(task);
  if (!label) return null;

  const late = label.key === 'task.schedule.late';
  const text =
    label.key === 'task.schedule.window'
      ? t(label.key, { start: formatDay(label.start), due: formatDay(label.due) })
      : t(label.key, { date: formatDay(label.date) });

  return <span className={`text-[11px] ${late ? 'text-destructive' : 'text-muted-foreground'}`}>{text}</span>;
}

/** Carte d'une tâche : statut, échéance, nombre de versions, dernière image connue. */
function TaskCard({
  task,
  projectId,
  onOpen,
}: {
  task: AssetTreeTask;
  projectId: number;
  onOpen: () => void;
}) {
  const t = useT();
  const sgLinks = useSgLinks(projectId);
  const sgUrl = task.id ? sgLinks.linkFor('task', task.id) : null;
  const latest = task.versions[0];
  const thumbnail = task.versions.flatMap((v) => v.media).find((m) => m.thumbnailUrl)?.thumbnailUrl;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full flex-col overflow-hidden rounded-md border border-border bg-card text-left transition-colors hover:border-primary/60"
    >
      <div className="flex h-24 items-center justify-center overflow-hidden bg-secondary/30">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <FileStack size={20} className="text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate text-sm font-medium">
            {task.id === null ? t('asset.tree.looseVersions') : task.name}
          </span>
          {sgUrl && (
            <span
              role="link"
              tabIndex={0}
              title={t('shotgrid.openIn.task')}
              onClick={(e) => {
                e.stopPropagation();
                window.open(sgUrl, '_blank', 'noreferrer');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  window.open(sgUrl, '_blank', 'noreferrer');
                }
              }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <ExternalLink size={13} />
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {task.id !== null && (
            <PipelineStatusBadge statusId={task.pipelineStatusId} scope="task" size="xs" />
          )}
          <span className="text-[11px] text-muted-foreground">
            {t('asset.tree.versionCount', { count: task.versions.length })}
          </span>
        </div>
        <TaskSchedule task={task} />
        {latest && (
          <span className="text-[11px] text-muted-foreground">
            {t('asset.card.latest', {
              name: latest.name,
              date: new Date(latest.createdAt).toLocaleDateString(intlLocale()),
            })}
          </span>
        )}
      </div>
    </button>
  );
}

/** Versions d'une tâche, une fois la carte ouverte. */
function TaskVersions({
  task,
  department,
  projectId,
  onBack,
}: {
  task: AssetTreeTask;
  department: string;
  projectId: number;
  onBack: () => void;
}) {
  const t = useT();
  const sgLinks = useSgLinks(projectId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-sm hover:bg-secondary/60"
        >
          <ChevronLeft size={14} /> {t('common.back')}
        </button>
        <h3 className="text-sm font-medium">
          {task.id === null ? t('asset.tree.looseVersions') : task.name}
        </h3>
        <span className="text-xs text-muted-foreground">{department || t('pipeline.dept.none')}</span>
        {task.id !== null && (
          <>
            <PipelineStatusBadge statusId={task.pipelineStatusId} scope="task" />
            <TaskSchedule task={task} />
            <Link to={`/tasks/${task.id}`} className="text-xs text-muted-foreground hover:text-foreground">
              {t('asset.card.openTask')}
            </Link>
          </>
        )}
      </div>

      {task.versions.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
          {t('asset.tree.noVersion')}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {task.versions.map((v) => (
            <VersionCard key={v.id} version={v} sgUrl={sgLinks.linkFor('version', v.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function VersionCard({ version, sgUrl }: { version: AssetTreeVersion; sgUrl: string | null }) {
  const t = useT();
  const media = version.media[0];

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      {media ? (
        <Link to={reviewPath(media)} className="block h-28 overflow-hidden bg-secondary/30">
          {media.thumbnailUrl ? (
            <img src={media.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {media.kind}
            </span>
          )}
        </Link>
      ) : (
        <div className="flex h-28 items-center justify-center bg-secondary/20 text-xs text-muted-foreground">
          {t('asset.card.noMedia')}
        </div>
      )}
      <div className="space-y-1.5 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{version.name}</span>
          {sgUrl && (
            <a
              href={sgUrl}
              target="_blank"
              rel="noreferrer"
              title={t('shotgrid.openIn.version')}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <ExternalLink size={12} />
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {version.reviewStatus && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px]"
              style={{
                backgroundColor: `${version.reviewStatus.color}22`,
                color: version.reviewStatus.color,
              }}
            >
              {version.reviewStatus.name}
            </span>
          )}
          {!version.published && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {t('media.draft')}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">
            {new Date(version.createdAt).toLocaleDateString(intlLocale())}
          </span>
        </div>
        {version.media.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {version.media.slice(1).map((m) => (
              <Link
                key={m.id}
                to={reviewPath(m)}
                title={m.originalName}
                className="flex h-7 w-10 items-center justify-center overflow-hidden rounded border border-border hover:border-primary"
              >
                {m.thumbnailUrl ? (
                  <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[9px] text-muted-foreground">{m.kind}</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
