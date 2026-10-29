// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, MessageSquare } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { projectPath } from '../lib/slug';
import { useAuth } from '../stores/useAuth';
import { deliverFiles } from '../stores/deliverFiles';
import PageShell from '../components/PageShell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import FullPageDropzone from '../components/FullPageDropzone';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { TASK_STATUS_COLOR, TASK_STATUS_LABEL_KEY } from '../lib/taskStatus';
import { useVersions } from './task/useVersions';
import VersionTimeline from './task/VersionTimeline';
import TaskChecklist from './task/TaskChecklist';
import TaskDescription from './task/TaskDescription';
import TaskSchedule from './task/TaskSchedule';
import type { TaskDetail } from '../types/api';
import { useT } from '../i18n';
import EntityContextMenu from '../components/ui/entity-menu';
import { useStatusMenu } from '../lib/useStatusMenu';
import { useProjectRole } from '../lib/useProjectRole';
import { entriesOf } from '../lib/menuSpec';
import EntityUnavailable from '../components/EntityUnavailable';
import { isBadId, isMissingOrForbidden } from '../components/entityAvailability';

export default function TaskPage() {
  const t = useT();
  const { id } = useParams();
  const taskId = Number(id);
  const role = useAuth((s) => s.user?.role);
  const userId = useAuth((s) => s.user?.id);
  const canCreate = role !== 'CLIENT';
  const canPublish = role === 'ADMIN' || role === 'SUPERVISOR';
  const taskQ = useQuery({
    queryKey: qk.task(taskId),
    queryFn: () => api.get<{ task: TaskDetail }>(`/api/tasks/${taskId}`).then((d) => d.task),
  });
  const task = taskQ.data ?? null;
  const {
    versions,
    isLoading,
    loadError,
    createVersion,
    publishVersion,
    publishMedia,
    removeVersion,
    removeMedia,
  } = useVersions({ taskId });

  const project = task?.shot?.project ?? task?.asset?.project;
  /**
   * Right to write the brief: EFFECTIVE role on the project (38.E), not the account's global role —
   * a supervisor named on that project writes the brief for its tasks. The
   * rest of the page keeps its original control (`canPublish`), which belongs to
   * version publishing and not to this phase.
   */
  const { canManage } = useProjectRole(project?.id ?? 0);

  /**
   * Dropping creates the next version and fills it (Phase 46): the dedicated zone now lives
   * at the head of the version list, and each existing version is its own target.
   *
   * Grouping into sequences and the instruction required by the project are decided BEFORE the
   * creation of the version (Phase 50): an abandoned drop must not leave behind
   * an empty version.
   */
  const onDropFiles = (files: File[]) =>
    deliverFiles(project?.id, files, async (send) => {
      const created = await createVersion();
      if (created) send(created.id);
    });

  const { entry: statusEntry } = useStatusMenu(project?.id ?? 0, 'task');
  const menuEntries = entriesOf(
    task ? statusEntry(task, { canEdit: canPublish || task.assignee?.id === userId }) : null,
  );

  // After all the hooks: a `/tasks/abc` gave "Task #NaN" with an active drop zone,
  // and an unknown identifier rendered the page as if the task existed.
  if (isBadId(taskId) || (taskQ.isError && isMissingOrForbidden(taskQ.error)))
    return <EntityUnavailable kind="task" error={isBadId(taskId) ? undefined : taskQ.error} />;
  if (taskQ.isError)
    return <EntityUnavailable kind="task" error={taskQ.error} onRetry={() => void taskQ.refetch()} />;

  return (
    <PageShell
      title={task?.name ?? t('entity.task')}
      breadcrumb={<EntityBreadcrumb entity="task" id={taskId} />}
    >
      {/* The status is changed here by right click, as everywhere else. The assignee has the
          right: the server only accepts from them the status and the checklist. */}
      <EntityContextMenu entries={menuEntries}>
        {/* Location (project › shot/asset) */}
        <div className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {project && (
            <Link to={projectPath(project)} className="hover:text-foreground">
              {project.name}
            </Link>
          )}
          {task?.shot && (
            <>
              <ChevronRight size={12} />
              <Link to={`/shots/${task.shot.id}`} className="hover:text-foreground">
                {task.shot.sequence ? `${task.shot.sequence.code} · ` : ''}
                {task.shot.code}
              </Link>
            </>
          )}
          {task?.asset && (
            <>
              <ChevronRight size={12} />
              <Link to={`/assets/${task.asset.id}`} className="hover:text-foreground">
                {task.asset.name}
              </Link>
            </>
          )}
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{task?.name ?? t('task.fallbackName', { id: taskId })}</h1>
            {task && <Badge variant="secondary">{task.type}</Badge>}
            {task && (
              <span className={`rounded px-2 py-0.5 text-xs ${TASK_STATUS_COLOR[task.status] ?? ''}`}>
                {TASK_STATUS_LABEL_KEY[task.status] ? t(TASK_STATUS_LABEL_KEY[task.status]) : task.status}
              </span>
            )}
            {/* Return link (32.D): the review opens on the original comment. */}
            {task?.sourceComment && (
              <Link
                to={`/review/${task.sourceComment.mediaObjectId}?comment=${task.sourceComment.id}`}
                className="flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <MessageSquare size={12} /> {t('comment.original')}
              </Link>
            )}
          </div>
          {canCreate && (
            <Button size="sm" onClick={() => createVersion()}>
              {t('version.newPlus')}
            </Button>
          )}
        </div>
        {loadError && <p className="mb-4 text-sm text-destructive">{loadError}</p>}

        {task && <TaskDescription taskId={taskId} description={task.description} canEdit={canManage} />}

        {task && (
          <TaskSchedule
            taskId={taskId}
            projectId={project?.id ?? null}
            startDate={task.startDate}
            dueDate={task.dueDate}
            canEdit={canPublish}
          />
        )}

        {task && (
          <TaskChecklist
            taskId={taskId}
            items={task.checklist ?? []}
            canToggle={canPublish || task.assignee?.id === userId}
            canEditItems={canPublish}
          />
        )}

        <VersionTimeline
          versions={versions}
          isLoading={isLoading}
          canCreate={canCreate}
          canPublish={canPublish}
          contextKey={`task:${taskId}`}
          projectId={project?.id ?? null}
          emptyDescription={canCreate ? t('version.emptyTask') : t('version.noneTask')}
          onCreateVersion={() => void createVersion()}
          onDropNewVersion={(files) => void onDropFiles(files)}
          publishVersion={publishVersion}
          publishMedia={publishMedia}
          removeVersion={removeVersion}
          removeMedia={removeMedia}
        />

        {canCreate && (
          <FullPageDropzone
            onDrop={onDropFiles}
            label={versions[0] ? t('version.dropInto', { name: versions[0].name }) : t('version.dropAsset')}
          />
        )}
      </EntityContextMenu>
    </PageShell>
  );
}
