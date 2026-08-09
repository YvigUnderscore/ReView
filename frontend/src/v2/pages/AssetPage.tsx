// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
import AssetTree from './asset/AssetTree';
import { SkeletonRows } from '../components/ui/skeleton';
import type { AssetDetail, AssetOverview } from '../types/api';
import { useT } from '../i18n';

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
   * Déposer crée la version suivante et l'emplit (Phase 46) : c'est le geste par défaut,
   * celui qu'on attend en lâchant un rendu sur un asset. Pour alimenter une version
   * existante, on la vise directement — chaque carte est sa propre cible.
   */
  const onDropFiles = async (files: File[]) => {
    const created = await createVersion();
    if (created) files.forEach((f) => enqueue(f, created.id));
  };

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
      {treeQ.isLoading ? <SkeletonRows count={3} /> : <AssetTree groups={overview?.groups ?? []} />}

      <div className="mb-3 mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('asset.tree.direct')}</h2>
        {canCreate && (
          <Button size="sm" onClick={() => void createVersion()}>
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
    </Shell>
  );
}
