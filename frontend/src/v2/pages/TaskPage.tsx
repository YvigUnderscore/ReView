import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useAuth } from '../stores/useAuth';
import { useUploadStore } from '../../stores/useUploadStore';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import FullPageDropzone from '../components/FullPageDropzone';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { TASK_STATUS_COLOR, TASK_STATUS_LABEL } from '../lib/taskStatus';
import { useVersions } from './task/useVersions';
import VersionTimeline from './task/VersionTimeline';
import TaskDropzone from './task/TaskDropzone';
import type { TaskDetail } from '../types/api';

export default function TaskPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const role = useAuth((s) => s.user?.role);
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
    <Shell title={task?.name ?? 'Tâche'} breadcrumb={<EntityBreadcrumb entity="task" id={taskId} />}>
      {/* Localisation (projet › shot/asset) */}
      <div className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {project && (
          <Link to={`/projects/${project.id}`} className="hover:text-foreground">
            {project.name}
          </Link>
        )}
        {task?.shot && (
          <>
            <ChevronRight size={12} />
            <Link
              to={`/projects/${task.shot.project.id}?tab=shots&shot=${task.shot.id}`}
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
          <h1 className="text-xl font-semibold">{task?.name ?? `Tâche #${taskId}`}</h1>
          {task && <Badge variant="secondary">{task.type}</Badge>}
          {task && (
            <span className={`rounded px-2 py-0.5 text-xs ${TASK_STATUS_COLOR[task.status] ?? ''}`}>
              {TASK_STATUS_LABEL[task.status] ?? task.status}
            </span>
          )}
        </div>
        {canCreate && (
          <Button size="sm" onClick={() => createVersion()}>
            + Nouvelle version
          </Button>
        )}
      </div>
      {loadError && <p className="mb-4 text-sm text-destructive">{loadError}</p>}

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
        emptyDescription={
          canCreate
            ? 'Créez une première version ou déposez un média ci-dessus pour démarrer l’historique de cette tâche.'
            : 'Aucune version publiée pour cette tâche.'
        }
        onCreateVersion={() => void createVersion()}
        publishVersion={publishVersion}
        publishMedia={publishMedia}
        removeVersion={removeVersion}
        removeMedia={removeMedia}
      />

      {canCreate && (
        <FullPageDropzone
          onDrop={onDropFiles}
          label={
            versions[0]
              ? `Déposez pour ajouter à ${versions[0].name}`
              : 'Déposez pour créer une première version'
          }
        />
      )}
    </Shell>
  );
}
