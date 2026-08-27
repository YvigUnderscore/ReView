// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useUploadStore } from '../../stores/useUploadStore';
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
import { useProjectRole } from '../lib/useProjectRole';
import type { MenuEntry } from '../lib/menuSpec';
import type { AssetDetail, AssetOverview } from '../types/api';
import { useT } from '../i18n';
import EntityUnavailable from '../components/EntityUnavailable';
import { isBadId, isMissingOrForbidden } from '../components/entityAvailability';

/**
 * L'asset, comme page — même coquille qu'un plan et qu'une séquence (C3).
 *
 * Le statut et la pastille de synchronisation ShotGrid manquaient ici alors qu'un plan les
 * portait : le même asset se lisait autrement selon la page où on l'ouvrait.
 */
export default function AssetPage() {
  const t = useT();
  const { id } = useParams();
  const assetId = Number(id);
  const enqueue = useUploadStore((s) => s.enqueue);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [assigning, setAssigning] = useState(false);
  const [pending, setPending] = useState<File[] | 'empty' | null>(null);

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
   * celui qu'on attend en lâchant un rendu sur un asset. Quand l'asset a des tâches, on
   * demande d'abord laquelle : ranger un rendu de texturing « sur l'asset » perd l'étape
   * qui l'a produit, et prive la version poussée vers ShotGrid de son `sg_task`.
   */
  const withTask = async (files: File[] | 'empty', taskId: number | null) => {
    const created = await createVersion(taskId ? { taskId } : undefined);
    if (!created) return;
    if (files !== 'empty') files.forEach((f) => enqueue(f, created.id));
    // La timeline de cette page ne montre que les versions rattachées à l'asset : une
    // version rangée sous une tâche y serait invisible, et l'on n'aurait nulle part où
    // déposer son média.
    if (taskId) void navigate(`/tasks/${taskId}`);
  };

  const menuExtras: MenuEntry[] = [
    // Assigner quelqu'un et déclarer les étapes traversées : les deux gestes tenaient
    // dans un panneau de réglages, ils sont désormais à portée de clic droit.
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
    ...(canManage
      ? [
          {
            id: 'assign',
            label: t('task.manageAssignment'),
            icon: <Users size={14} />,
            onSelect: () => setAssigning(true),
          },
        ]
      : []),
  ];

  // Un identifiant inexploitable ou une entité absente rendaient jusqu'ici la coquille
  // complète, avec des actions actives sur un sujet qui n'existe pas.
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
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
        <AssetTaskCards groups={overview?.groups ?? []} projectId={projectId} />
      )}

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
