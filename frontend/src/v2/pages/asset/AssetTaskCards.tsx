// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ExternalLink, FileStack } from 'lucide-react';
import EmptyState from '../../components/ui/empty-state';
import EntityContextMenu from '../../components/ui/entity-menu';
import ViewToggle from '../../components/ViewToggle';
import Avatar from '../../components/Avatar';
import { initialsFrom } from '../../lib/initials';
import { assigneeName } from '../../lib/assigneeName';
import { useProjectRole } from '../../lib/useProjectRole';
import { useTaskAssignMenu } from '../../lib/useTaskAssignMenu';
import type { MenuEntry } from '../../lib/menuSpec';
import { useViewMode } from '../../stores/useViewPref';
import AssetTaskColumns from './AssetTaskColumns';
import VersionCard from './VersionCard';
import PipelineStatusBadge from '../../components/shotgrid/PipelineStatusBadge';
import { useSgLinks } from '../../components/shotgrid/useSgLinks';
import { useSgSteps } from '../../lib/shotgridTasksApi';
import SgSyncDot from '../../components/shotgrid/SgSyncDot';
import { useT, intlLocale } from '../../i18n';
import { scheduleLabel } from './taskSchedule';
import type { AssetTreeTask, DepartmentGroup } from '../../types/api';

/**
 * Asset tasks, as cards.
 *
 * The previous display stacked departments, tasks, versions and media in a
 * single column: on an asset that goes through four departments, the page became
 * unreadable before any work had started. Here, one card per task gives the
 * state at a glance; you enter a task to see its versions, and come back out. One
 * level at a time.
 */
export default function AssetTaskCards({
  groups,
  projectId,
  entityType = 'Asset',
  onNewTask,
}: {
  groups: DepartmentGroup<AssetTreeTask>[];
  projectId: number;
  /** The edge these tasks belong to: steps depend on it, and so do their colours. */
  entityType?: 'Asset' | 'Shot';
  /** Create the first task. Absent when the person is not allowed to. */
  onNewTask?: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { canManage } = useProjectRole(projectId);
  // Assigning someone to a step used to mean opening the task, then its settings.
  // In front of the cards the step is already in view: a right click is enough.
  const { assignEntry, departmentEntry } = useTaskAssignMenu(projectId);
  // Colours come from the site: this is how "groom" is green here as
  // over there, and a pipe can be read at a glance across both tools. The list is
  // already cached for this project, it costs no extra request.
  const { data: steps = [] } = useSgSteps(projectId, entityType);
  const colourOf = (task: AssetTreeTask): string | null =>
    steps.find((s) => s.code.toLowerCase() === (task.department ?? task.name).toLowerCase())?.color ?? null;
  const [openTaskId, setOpenTaskId] = useState<number | 'loose' | null>(null);
  // Columns or stack: the setting follows the person, like all lists.
  const view = useViewMode(`asset-tasks:${projectId}`);

  const allTasks = groups.flatMap((g) => g.items.map((task) => ({ task, group: g })));
  // Nothing to show, so nothing to right-click: this is the only place in the pipe where a
  // visible button is justified — without it, an entity with no task is a dead end.
  if (allTasks.length === 0)
    return (
      <EmptyState
        compact
        icon={FileStack}
        title={t('asset.tree.empty.title')}
        description={t('asset.tree.empty.description')}
        action={onNewTask ? t('task.new') : undefined}
        onAction={onNewTask}
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

  /** A task has its page: that is where one uploads media, publishes and sees the
   *  drafts. The collapsed view in this page could do none of that — an empty
   *  draft became a dead end. */
  const cardsOf = (group: DepartmentGroup<AssetTreeTask>) =>
    group.items.map((task) => {
      const card = (
        <TaskCard
          key={task.id ?? 'loose'}
          task={task}
          projectId={projectId}
          colour={colourOf(task)}
          onOpen={() => (task.id ? navigate(`/tasks/${task.id}`) : setOpenTaskId('loose'))}
        />
      );
      // The catch-all for versions without a task has nothing to assign: no menu on it.
      const entries =
        task.id === null
          ? []
          : [
              assignEntry({ id: task.id, assigneeId: task.assignee?.id ?? null }, canManage),
              departmentEntry({ id: task.id, department: task.department }, canManage),
            ].filter((entry): entry is MenuEntry => entry !== null);
      if (entries.length === 0) return card;
      return (
        <EntityContextMenu key={task.id ?? 'loose'} entries={entries}>
          {card}
        </EntityContextMenu>
      );
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <ViewToggle contextKey={`asset-tasks:${projectId}`} />
      </div>
      <AssetTaskColumns
        projectId={projectId}
        view={view}
        groups={groups.map((group) => ({
          key: group.key,
          name: group.name,
          count: group.items.length,
          children:
            view === 'compact' ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{cardsOf(group)}</div>
            ) : (
              cardsOf(group)
            ),
        }))}
      />
    </div>
  );
}

const formatDay = (value: string): string => (value ? new Date(value).toLocaleDateString(intlLocale()) : '—');

/** Work window of a task, as set by production. */
function TaskSchedule({ task }: { task: AssetTreeTask }) {
  const t = useT();
  const label = scheduleLabel(task);
  if (!label) return null;

  const late = label.key === 'task.schedule.late';
  const text =
    label.key === 'task.schedule.window'
      ? t(label.key, { start: formatDay(label.start), due: formatDay(label.due) })
      : t(label.key, { date: formatDay(label.date) });

  return <span className={`text-xs ${late ? 'text-destructive' : 'text-muted-foreground'}`}>{text}</span>;
}

/** Task card: status, due date, number of versions, last known image. */
function TaskCard({
  task,
  projectId,
  colour,
  onOpen,
}: {
  task: AssetTreeTask;
  projectId: number;
  /** Colour of the step on the site, when it has one. */
  colour: string | null;
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
      style={colour ? { borderLeft: `3px solid ${colour}` } : undefined}
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
          <SgSyncDot projectId={projectId} type="task" localId={task.id} />
          <span className="text-xs text-muted-foreground">
            {t('asset.tree.versionCount', { count: task.versions.length })}
          </span>
          {/* The person at the end of the row: it is the question one asks a pipe before
               all the others, and each task had to be opened to answer it. */}
          {task.assignee && (
            <span className="ml-auto flex items-center gap-1" title={assigneeName(task.assignee)}>
              <Avatar
                seed={task.assignee.id}
                initials={initialsFrom(assigneeName(task.assignee))}
                avatarUrl={task.assignee.avatarUrl}
                size={18}
              />
            </span>
          )}
        </div>
        <TaskSchedule task={task} />
        {latest && (
          <span className="text-xs text-muted-foreground">
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

/** Versions of a task, once the card is opened. */
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
