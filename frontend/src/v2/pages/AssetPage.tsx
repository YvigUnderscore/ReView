// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useAuth } from '../stores/useAuth';
import { useUploadStore } from '../../stores/useUploadStore';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import AssetAssignDialog from '../components/AssetAssignDialog';
import FavoriteButton from '../components/FavoriteButton';
import FullPageDropzone from '../components/FullPageDropzone';
import { Button } from '../components/ui/button';
import { useVersions } from './task/useVersions';
import VersionTimeline from './task/VersionTimeline';
import AssetLatestCard from './asset/AssetLatestCard';
import AssetTaskCards from './asset/AssetTaskCards';
import { SkeletonRows } from '../components/ui/skeleton';
import type { AssetDetail, AssetOverview } from '../types/api';
import { useT } from '../i18n';
import TaskPickerDialog from '../components/upload/TaskPickerDialog';

export default function AssetPage() {
  const t = useT();
  const { id } = useParams();
  const assetId = Number(id);
  const role = useAuth((s) => s.user?.role);
  const canCreate = role !== 'CLIENT';
  const canPublish = role === 'ADMIN' || role === 'SUPERVISOR';
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';
  const enqueue = useUploadStore((s) => s.enqueue);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [assigning, setAssigning] = useState(false);

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
  const assetQ = useQuery({
    queryKey: qk.asset(assetId),
    queryFn: () => api.get<{ asset: AssetDetail }>(`/api/assets/${assetId}`),
  });
  const asset = assetQ.data?.asset ?? null;
  // L'arbre du pipe : c'est lui qui montre les versions publiées SOUS une tâche, que la
  // timeline ci-dessous (versions rattachées directement à l'asset) ne voit pas.
  const treeQ = useQuery({
    queryKey: qk.assetTree(assetId),
    queryFn: () => api.get<AssetOverview>(`/api/assets/${assetId}/tree`),
  });
  const overview = treeQ.data ?? null;

  /**
   * Tâches auxquelles une version peut appartenir, telles que l'arbre les a déjà
   * chargées. Sur un projet relié, ce sont exactement celles de ShotGrid.
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
   * Déposer crée la version suivante et l'emplit (Phase 46) : c'est le geste par défaut,
   * celui qu'on attend en lâchant un rendu sur un asset. Pour alimenter une version
   * existante, on la vise directement — chaque carte est sa propre cible.
   *
   * Quand l'asset a des tâches, on demande d'abord laquelle : ranger un rendu de
   * texturing « sur l'asset » perd l'étape qui l'a produit, et prive la version poussée
   * vers ShotGrid de son `sg_task`. Sans tâche, rien ne change.
   */
  const [pending, setPending] = useState<File[] | 'empty' | null>(null);

  const startVersion = (files: File[] | 'empty') => setPending(files);

  const withTask = async (files: File[] | 'empty', taskId: number | null) => {
    const created = await createVersion(taskId ? { taskId } : undefined);
    if (!created) return;
    if (files !== 'empty') files.forEach((f) => enqueue(f, created.id));
    // La timeline de cette page ne montre que les versions rattachées à l'asset : une
    // version rangée sous une tâche y serait invisible, et l'on n'aurait nulle part où
    // déposer son média. On suit donc la version jusqu'à sa tâche, qui a sa zone de
    // dépôt et affiche ce qui vient d'être créé.
    if (taskId) navigate(`/tasks/${taskId}`);
  };

  const onDropFiles = (files: File[]) => startVersion(files);

  return (
    <Shell breadcrumb={<EntityBreadcrumb entity="asset" id={assetId} />}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">
            {asset ? asset.name : `Asset #${assetId}`}
            {asset && <span className="ml-2 text-sm font-normal text-muted-foreground">{asset.type}</span>}
          </h1>
          <FavoriteButton type="ASSET" entityId={assetId} size={18} />
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link to={`/assets/${assetId}/board`} className="text-primary hover:underline">
            Board
          </Link>
          <Link to="/projects" className="text-muted-foreground hover:text-foreground">
            {t('nav.backToProjects')}
          </Link>
        </div>
      </div>
      {loadError && <p className="mb-4 text-sm text-destructive">{loadError}</p>}

      {asset && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('task.assignedTo')}
          </span>
          {asset.sequences.length === 0 && asset.shots.length === 0 && (
            <span className="text-xs text-muted-foreground">{t('asset.noSequenceShot')}</span>
          )}
          {asset.sequences.map((s) => (
            <span
              key={`seq-${s.id}`}
              className="rounded border border-border bg-background px-2 py-0.5 text-xs"
            >
              SEQ {s.code} · {s.name}
            </span>
          ))}
          {asset.shots.map((s) => (
            <span
              key={`shot-${s.id}`}
              className="rounded border border-border bg-background px-2 py-0.5 text-xs"
            >
              SH {s.code} · {s.name}
            </span>
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
        <AssetTaskCards groups={overview?.groups ?? []} projectId={asset?.projectId ?? 0} />
      )}

      <div className="mb-3 mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('asset.tree.direct')}</h2>
        {canCreate && (
          <Button size="sm" onClick={() => startVersion('empty')}>
            {t('version.newPlus')}
          </Button>
        )}
      </div>

      <VersionTimeline
        versions={versions}
        isLoading={isLoading}
        canCreate={canCreate}
        canPublish={canPublish}
        contextKey={`asset:${assetId}`}
        projectId={asset?.projectId ?? null}
        emptyDescription={canCreate ? t('version.emptyAsset') : t('version.noneAsset')}
        onCreateVersion={() => startVersion('empty')}
        onDropNewVersion={(files) => void onDropFiles(files)}
        publishVersion={publishVersion}
        publishMedia={publishMedia}
        removeVersion={removeVersion}
        removeMedia={removeMedia}
      />

      <TaskPickerDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        tasks={pickableTasks}
        projectId={asset?.projectId ?? 0}
        parent={{ kind: 'asset', id: assetId }}
        allowNone
        onPick={(taskId) => {
          const files = pending;
          setPending(null);
          if (files !== null) void withTask(files, taskId);
        }}
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
