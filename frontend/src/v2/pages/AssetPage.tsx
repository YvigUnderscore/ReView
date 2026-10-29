// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListPlus, Plus, Users } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { deliverFiles } from '../../stores/deliverFiles';
import EntityWorkPage from '../components/entity/EntityWorkPage';
import { useAssignMenu, useDepartmentMenu } from '../lib/useAssignMenu';
import { entriesOf } from '../lib/menuSpec';
import AssetAssignDialog from '../components/AssetAssignDialog';
import FullPageDropzone from '../components/FullPageDropzone';
import { Button } from '../components/ui/button';
import { useVersions } from './task/useVersions';
import VersionTimeline from './task/VersionTimeline';
import AssetLatestCard from './asset/AssetLatestCard';
import AssetTaskCards from './asset/AssetTaskCards';
import { SkeletonRows } from '../components/ui/skeleton';
import TaskPickerDialog from '../components/upload/TaskPickerDialog';
import NewTaskDialog from '../components/entity/NewTaskDialog';
import { useProjectRole } from '../lib/useProjectRole';
import type { MenuEntry } from '../lib/menuSpec';
import { useMarkVisited } from '../lib/useVisits';
import type { AssetDetail, AssetOverview } from '../types/api';
import { useT } from '../i18n';
import EntityUnavailable from '../components/EntityUnavailable';
import { isBadId, isMissingOrForbidden } from '../components/entityAvailability';

/**
 * The asset, as a page: same shell as a shot and a sequence (C3).
 *
 * The ShotGrid status and sync badge were missing here although a shot carried them: the
 * same asset read differently depending on the page it was opened from.
 */
export default function AssetPage() {
  const t = useT();
  const { id } = useParams();
  const assetId = Number(id);
  // Opening is consulting: the "not consulted" glow switches off here (batch 9).
  useMarkVisited('ASSET', assetId);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [assigning, setAssigning] = useState(false);
  const [pending, setPending] = useState<File[] | 'empty' | null>(null);
  const [newTask, setNewTask] = useState(false);

  const assetQ = useQuery({
    queryKey: qk.asset(assetId),
    queryFn: () => api.get<{ asset: AssetDetail }>(`/api/assets/${assetId}`),
  });
  const asset = assetQ.data?.asset ?? null;
  const projectId = asset?.projectId ?? 0;
  const { canManage, canContribute } = useProjectRole(projectId);
  const canPublish = canManage;
  const { assignEntry } = useAssignMenu(projectId, 'asset');
  const { entry: departmentEntry } = useDepartmentMenu(projectId, 'asset', assetId);

  const {
    versions,
    isLoading,
    loadError,
    createVersion,
    publishVersion,
    publishMedia,
    removeVersion,
    removeMedia,
  } = useVersions({ assetId });

  // The pipe tree: it is what shows the versions published UNDER a task, which the
  // timeline below (versions attached directly to the asset) does not see.
  const treeQ = useQuery({
    queryKey: qk.assetTree(assetId),
    queryFn: () => api.get<AssetOverview>(`/api/assets/${assetId}/tree`),
  });
  const overview = treeQ.data ?? null;

  /**
   * Tasks a version can belong to, as the tree has already
   * loaded them. On a linked project, these are exactly those of ShotGrid.
   */
  const pickableTasks = useMemo(
    () =>
      (overview?.groups ?? [])
        .flatMap((g) => g.items)
        .filter((task): task is typeof task & { id: number } => task.id !== null)
        .map((task) => ({
          id: task.id,
          name: task.name,
          department: task.department,
          pipelineStatusId: task.pipelineStatusId,
          versionCount: task.versions.length,
        })),
    [overview],
  );

  /**
   * Dropping creates the next version and fills it (Phase 46): this is the default gesture,
   * the one expected when dropping a render onto an asset. When the asset has tasks, one
   * is asked first: filing a texturing render "on the asset" loses the step
   * that produced it, and deprives the version pushed to ShotGrid of its `sg_task`.
   */
  const fill = async (taskId: number | null, send?: (versionId: number) => void) => {
    const created = await createVersion(taskId ? { taskId } : undefined);
    if (!created) return;
    send?.(created.id);
    // This page's timeline only shows versions attached to the asset: a version filed
    // under a task would be invisible there, and there would be nowhere to
    // drop its media.
    if (taskId) void navigate(`/tasks/${taskId}`);
  };

  const withTask = (files: File[] | 'empty', taskId: number | null) => {
    // Grouping and instruction are decided BEFORE creating the version: an abandoned drop
    // must not leave an empty version behind (Phase 50). Creating an empty version, however,
    // is not a drop and has nothing to justify.
    if (files === 'empty') return fill(taskId);
    return deliverFiles(projectId, files, (send) => fill(taskId, send));
  };

  const menuExtras: MenuEntry[] = [
    // Assigning someone and declaring the steps traversed: both gestures lived
    // in a settings panel, they are now within reach of a right click.
    ...entriesOf(
      asset ? assignEntry(asset, canManage) : null,
      departmentEntry(asset?.departments, canManage),
    ),
    ...(canContribute
      ? [
          {
            id: 'new-version',
            label: t('version.newPlus'),
            icon: <Plus size={14} />,
            onSelect: () => setPending('empty'),
          },
        ]
      : []),
    // Setting a step on the asset: the gesture only existed indirectly — by requesting
    // a version, or by assigning someone — and not at all without ShotGrid.
    ...(canManage
      ? [
          {
            id: 'new-task',
            label: t('task.new'),
            icon: <ListPlus size={14} />,
            onSelect: () => setNewTask(true),
          },
          {
            id: 'assign',
            label: t('task.manageAssignment'),
            icon: <Users size={14} />,
            onSelect: () => setAssigning(true),
          },
        ]
      : []),
  ];

  // An unusable identifier or a missing entity used to render the full
  // shell, with active actions on a subject that does not exist.
  if (isBadId(assetId) || (assetQ.isError && isMissingOrForbidden(assetQ.error)))
    return <EntityUnavailable kind="asset" error={isBadId(assetId) ? undefined : assetQ.error} />;
  if (assetQ.isError)
    return <EntityUnavailable kind="asset" error={assetQ.error} onRetry={() => void assetQ.refetch()} />;

  return (
    <EntityWorkPage
      kind="asset"
      id={assetId}
      projectId={projectId}
      title={asset ? asset.name : `Asset #${assetId}`}
      subtitle={asset?.typeLabel ?? asset?.type ?? null}
      entity={asset ?? {}}
      thumbnailUrl={asset?.thumbnailUrl}
      canManage={canManage}
      menuExtras={menuExtras}
      actions={
        <Link
          to={`/assets/${assetId}/board`}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary/60"
        >
          Board
        </Link>
      }
    >
      {loadError && <p className="mb-4 text-sm text-destructive">{loadError}</p>}
      {asset?.description && (
        <p className="mb-5 max-w-3xl whitespace-pre-line text-sm text-muted-foreground">
          {asset.description}
        </p>
      )}

      {asset && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm">
          <span className="text-xs font-semibold section-label text-muted-foreground">
            {t('task.assignedTo')}
          </span>
          {asset.sequences.length === 0 && asset.shots.length === 0 && (
            <span className="text-xs text-muted-foreground">{t('asset.noSequenceShot')}</span>
          )}
          {asset.sequences.map((s) => (
            <Link
              key={`seq-${s.id}`}
              to={`/sequences/${s.id}`}
              className="rounded border border-border bg-background px-2 py-0.5 text-xs hover:border-primary"
            >
              {s.code} · {s.name}
            </Link>
          ))}
          {asset.shots.map((s) => (
            <Link
              key={`shot-${s.id}`}
              to={`/shots/${s.id}`}
              className="rounded border border-border bg-background px-2 py-0.5 text-xs hover:border-primary"
            >
              {s.code} · {s.name}
            </Link>
          ))}
          {canManage && (
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setAssigning(true)}>
              {t('task.manageAssignment')}
            </Button>
          )}
        </div>
      )}
      {assigning && asset && (
        <AssetAssignDialog
          assetId={asset.id}
          projectId={asset.projectId}
          assetName={asset.name}
          onClose={() => setAssigning(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: qk.asset(assetId) })}
        />
      )}
      {overview?.latest && <AssetLatestCard assetId={assetId} latest={overview.latest} />}

      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t('asset.tree.title')}</h2>
      {treeQ.isLoading ? (
        <SkeletonRows count={3} />
      ) : (
        <AssetTaskCards
          groups={overview?.groups ?? []}
          projectId={projectId}
          onNewTask={canManage ? () => setNewTask(true) : undefined}
        />
      )}

      <NewTaskDialog
        open={newTask}
        onOpenChange={setNewTask}
        projectId={projectId}
        parent={{ kind: 'asset', id: assetId }}
        onCreated={() => void qc.invalidateQueries({ queryKey: qk.assetTree(assetId) })}
      />

      <div className="mb-3 mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('asset.tree.direct')}</h2>
        {canContribute && (
          <Button size="sm" onClick={() => setPending('empty')}>
            {t('version.newPlus')}
          </Button>
        )}
      </div>

      <VersionTimeline
        versions={versions}
        isLoading={isLoading}
        canCreate={canContribute}
        canPublish={canPublish}
        contextKey={`asset:${assetId}`}
        projectId={projectId || null}
        emptyDescription={canContribute ? t('version.emptyAsset') : t('version.noneAsset')}
        onCreateVersion={() => setPending('empty')}
        onDropNewVersion={(files) => setPending(files)}
        publishVersion={publishVersion}
        publishMedia={publishMedia}
        removeVersion={removeVersion}
        removeMedia={removeMedia}
      />

      <TaskPickerDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        tasks={pickableTasks}
        projectId={projectId}
        parent={{ kind: 'asset', id: assetId }}
        allowNone
        onPick={(taskId) => {
          const files = pending;
          setPending(null);
          if (files !== null) void withTask(files, taskId);
        }}
      />

      {canContribute && (
        <FullPageDropzone
          onDrop={(files) => setPending(files)}
          label={versions[0] ? t('version.dropInto', { name: versions[0].name }) : t('version.dropAsset')}
        />
      )}
    </EntityWorkPage>
  );
}
