// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, MessageSquare } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { projectPath } from '../lib/slug';
import { useAuth } from '../stores/useAuth';
import { useUploadStore } from '../../stores/useUploadStore';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import FullPageDropzone from '../components/FullPageDropzone';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { TASK_STATUS_COLOR, TASK_STATUS_LABEL_KEY } from '../lib/taskStatus';
import { useVersions } from './task/useVersions';
import VersionTimeline from './task/VersionTimeline';
import TaskDropzone from './task/TaskDropzone';
import TaskChecklist from './task/TaskChecklist';
import TaskSchedule from './task/TaskSchedule';
import type { TaskDetail } from '../types/api';
import { useT } from '../i18n';

export default function TaskPage() {
  const t = useT();
  const { id } = useParams();
  const taskId = Number(id);
  const role = useAuth((s) => s.user?.role);
  const userId = useAuth((s) => s.user?.id);
  const canCreate = role !== 'CLIENT';
  const canPublish = role === 'ADMIN' || role === 'SUPERVISOR';
  const enqueue = useUploadStore((s) => s.enqueue);
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

  // Drop-zone permanente : dépose vers la dernière version (en crée une si besoin).
  const onDropFiles = async (files: File[]) => {
    let vid: number | null = versions[0]?.id ?? null;
    if (vid == null) vid = (await createVersion())?.id ?? null;
    if (vid != null) files.forEach((f) => enqueue(f, vid!));
  };

  const project = task?.shot?.project ?? task?.asset?.project;

  return (
    <Shell title={task?.name ?? t('entity.task')} breadcrumb={<EntityBreadcrumb entity="task" id={taskId} />}>
      {/* Localisation (projet › shot/asset) */}
      <div className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {project && (
          <Link to={projectPath(project)} className="hover:text-foreground">
            {project.name}
          </Link>
        )}
        {task?.shot && (
          <>
            <ChevronRight size={12} />
            <Link
              to={projectPath(task.shot.project, `?tab=shots&shot=${task.shot.id}`)}
              className="hover:text-foreground"
            >
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
              {TASK_STATUS_LABEL_KEY[task.status] ? t(TASK_STATUS_LABEL_KEY[task.status]!) : task.status}
            </span>
          )}
          {/* Lien retour (32.D) : la review s'ouvre sur le commentaire d'origine. */}
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

      {canCreate && (
        <div className="mb-4">
          <TaskDropzone latestVersionName={versions[0]?.name ?? null} onFiles={onDropFiles} />
        </div>
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
    </Shell>
  );
}
