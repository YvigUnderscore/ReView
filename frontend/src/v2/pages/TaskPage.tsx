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
import { withUploadNote } from '../../stores/useUploadNoteStore';
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

  const project = task?.shot?.project ?? task?.asset?.project;
  /**
   * Droit d'écrire la consigne : rôle EFFECTIF sur le projet (38.E), et non le rôle global
   * du compte — un superviseur nommé sur ce projet-là rédige le brief de ses tâches. Le
   * reste de la page garde son contrôle d'origine (`canPublish`), qui relève de la
   * publication de version et non de cette phase.
   */
  const { canManage } = useProjectRole(project?.id ?? 0);

  /**
   * Déposer crée la version suivante et l'emplit (Phase 46) : la zone dédiée vit désormais
   * en tête de la liste des versions, et chaque version existante est sa propre cible.
   *
   * La consigne exigée par le projet se demande AVANT la création de la version (Phase 50) :
   * un dépôt abandonné ne doit pas laisser derrière lui une version vide.
   */
  const onDropFiles = (files: File[]) =>
    withUploadNote(project?.id, async (note) => {
      const created = await createVersion();
      if (created) files.forEach((f) => enqueue(f, created.id, { note }));
    });

  const { entry: statusEntry } = useStatusMenu(project?.id ?? 0, 'task');
  const menuEntries = entriesOf(
    task ? statusEntry(task, { canEdit: canPublish || task.assignee?.id === userId }) : null,
  );

  // Après tous les hooks : un `/tasks/abc` donnait « Tâche #NaN » avec une zone de dépôt
  // active, et un identifiant inconnu rendait la page comme si la tâche existait.
  if (isBadId(taskId) || (taskQ.isError && isMissingOrForbidden(taskQ.error)))
    return <EntityUnavailable kind="task" error={isBadId(taskId) ? undefined : taskQ.error} />;
  if (taskQ.isError)
    return <EntityUnavailable kind="task" error={taskQ.error} onRetry={() => void taskQ.refetch()} />;

  return (
    <PageShell
      title={task?.name ?? t('entity.task')}
      breadcrumb={<EntityBreadcrumb entity="task" id={taskId} />}
    >
      {/* Le statut se change ici au clic droit, comme partout ailleurs. L'assigné en a le
          droit : le serveur n'accepte de lui que le statut et la checklist. */}
      <EntityContextMenu entries={menuEntries}>
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
