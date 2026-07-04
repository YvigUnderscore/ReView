import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Layers } from 'lucide-react';
import { useAuth } from '../stores/useAuth';
import { useUploadStore } from '../../stores/useUploadStore';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/ui/empty-state';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { TASK_STATUS_COLOR, TASK_STATUS_LABEL } from '../lib/taskStatus';
import { useTaskVersions } from './task/useTaskVersions';
import VersionTimelineItem from './task/VersionTimelineItem';
import TaskDropzone from './task/TaskDropzone';
import type { MediaSummary, VersionListItem } from '../types/api';

export default function TaskPage() {
  const { id } = useParams();
  const taskId = Number(id);
  const role = useAuth((s) => s.user?.role);
  const canCreate = role !== 'CLIENT';
  const canPublish = role === 'ADMIN' || role === 'SUPERVISOR';
  const enqueue = useUploadStore((s) => s.enqueue);
  const { task, versions, isLoading, loadError, createVersion, publishVersion, publishMedia, removeVersion, removeMedia } = useTaskVersions(taskId);

  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [delVersion, setDelVersion] = useState<VersionListItem | null>(null);
  const [delMedia, setDelMedia] = useState<{ versionId: number; media: MediaSummary } | null>(null);

  const onUploadClick = (versionId: number) => { setTarget(versionId); fileRef.current?.click(); };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && target != null) enqueue(file, target);
    if (fileRef.current) fileRef.current.value = '';
  };
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
        {project && <Link to={`/projects/${project.id}`} className="hover:text-foreground">{project.name}</Link>}
        {task?.shot && (
          <>
            <ChevronRight size={12} />
            <Link to={`/projects/${task.shot.project.id}?tab=shots&shot=${task.shot.id}`} className="hover:text-foreground">
              {task.shot.sequence ? `${task.shot.sequence.code} · ` : ''}{task.shot.code}
            </Link>
          </>
        )}
        {task?.asset && (
          <>
            <ChevronRight size={12} />
            <Link to={`/assets/${task.asset.id}`} className="hover:text-foreground">{task.asset.name}</Link>
          </>
        )}
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">{task?.name ?? `Tâche #${taskId}`}</h1>
          {task && <Badge variant="secondary">{task.type}</Badge>}
          {task && <span className={`rounded px-2 py-0.5 text-xs ${TASK_STATUS_COLOR[task.status] ?? ''}`}>{TASK_STATUS_LABEL[task.status] ?? task.status}</span>}
        </div>
        {canCreate && <Button size="sm" onClick={() => createVersion()}>+ Nouvelle version</Button>}
      </div>
      {loadError && <p className="mb-4 text-sm text-destructive">{loadError}</p>}

      {canCreate && (
        <div className="mb-4">
          <TaskDropzone latestVersionName={versions[0]?.name ?? null} onFiles={onDropFiles} />
        </div>
      )}
      <input ref={fileRef} type="file" className="hidden" onChange={onFile} />

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : versions.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="Aucune version"
          description={canCreate ? 'Créez une première version ou déposez un média ci-dessus pour démarrer l’historique de cette tâche.' : 'Aucune version publiée pour cette tâche.'}
          action={canCreate ? 'Créer une version' : undefined}
          onAction={canCreate ? () => createVersion() : undefined}
        />
      ) : (
        <ol className="ml-1">
          {versions.map((v, i) => (
            <VersionTimelineItem
              key={v.id}
              version={v}
              isLast={i === versions.length - 1}
              defaultOpen={i === 0}
              canCreate={canCreate}
              canPublish={canPublish}
              onUpload={onUploadClick}
              onPublishVersion={publishVersion}
              onDeleteVersion={setDelVersion}
              onPublishMedia={publishMedia}
              onDeleteMedia={(versionId, media) => setDelMedia({ versionId, media })}
            />
          ))}
        </ol>
      )}

      <ConfirmDialog
        open={!!delVersion}
        title="Supprimer la version ?"
        message={<>La version « {delVersion?.name} » et ses médias seront déplacés dans la corbeille du projet.</>}
        confirmLabel="Mettre à la corbeille"
        danger
        onConfirm={() => { if (delVersion) removeVersion(delVersion.id); setDelVersion(null); }}
        onCancel={() => setDelVersion(null)}
      />
      <ConfirmDialog
        open={!!delMedia}
        title="Supprimer le média ?"
        message={<>« {delMedia?.media.originalName} » sera déplacé dans la corbeille du projet.</>}
        confirmLabel="Mettre à la corbeille"
        danger
        onConfirm={() => { if (delMedia) removeMedia(delMedia.versionId, delMedia.media.id); setDelMedia(null); }}
        onCancel={() => setDelMedia(null)}
      />
    </Shell>
  );
}
