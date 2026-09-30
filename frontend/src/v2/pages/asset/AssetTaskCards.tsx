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
  entityType = 'Asset',
  onNewTask,
}: {
  groups: DepartmentGroup<AssetTreeTask>[];
  projectId: number;
  /** Le bord auquel ces tâches appartiennent — les étapes en dépendent, et leurs couleurs. */
  entityType?: 'Asset' | 'Shot';
  /** Créer la première tâche. Absent quand la personne n'en a pas le droit. */
  onNewTask?: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { canManage } = useProjectRole(projectId);
  // Mettre quelqu'un sur une étape se faisait en ouvrant la tâche, puis ses réglages.
  // Devant les cartes, l'étape est déjà sous les yeux : le clic droit suffit.
  const { assignEntry, departmentEntry } = useTaskAssignMenu(projectId);
  // Les couleurs viennent du site : c'est ainsi que « groom » est vert ici comme
  // là-bas, et qu'un pipe se relit d'un coup d'œil entre les deux outils. La liste est
  // déjà en cache pour ce projet, elle ne coûte pas une requête de plus.
  const { data: steps = [] } = useSgSteps(projectId, entityType);
  const colourOf = (task: AssetTreeTask): string | null =>
    steps.find((s) => s.code.toLowerCase() === (task.department ?? task.name).toLowerCase())?.color ?? null;
  const [openTaskId, setOpenTaskId] = useState<number | 'loose' | null>(null);
  // Colonnes ou pile : le réglage suit la personne, comme toutes les listes.
  const view = useViewMode(`asset-tasks:${projectId}`);

  const allTasks = groups.flatMap((g) => g.items.map((task) => ({ task, group: g })));
  // Rien à montrer, donc rien où faire un clic droit : c'est le seul endroit du pipe où un
  // bouton visible se justifie — sans lui, une entité sans tâche est un cul-de-sac.
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

  /** Une tâche a sa page : c'est là qu'on dépose un média, qu'on publie et qu'on voit les
   *  brouillons. La vue repliée dans cette page ne savait rien faire de tout cela — un
   *  brouillon vide y devenait un cul-de-sac. */
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
      // Le fourre-tout des versions sans tâche n'a rien à assigner : pas de menu dessus.
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

  return <span className={`text-xs ${late ? 'text-destructive' : 'text-muted-foreground'}`}>{text}</span>;
}

/** Carte d'une tâche : statut, échéance, nombre de versions, dernière image connue. */
function TaskCard({
  task,
  projectId,
  colour,
  onOpen,
}: {
  task: AssetTreeTask;
  projectId: number;
  /** Couleur de l'étape sur le site, quand elle en a une. */
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
          {/* La personne en fin de ligne : c'est la question qu'on pose à un pipe avant
              toutes les autres, et il fallait ouvrir chaque tâche pour y répondre. */}
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
