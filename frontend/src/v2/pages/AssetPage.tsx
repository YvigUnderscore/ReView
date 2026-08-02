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
import type { AssetDetail } from '../types/api';
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

  // Drop-zone plein-écran : dépose vers la dernière version (en crée une si besoin).
  const onDropFiles = async (files: File[]) => {
    let vid: number | null = versions[0]?.id ?? null;
    if (vid == null) vid = (await createVersion())?.id ?? null;
    if (vid != null) files.forEach((f) => enqueue(f, vid!));
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
            ← Projets
          </Link>
        </div>
      </div>
      {loadError && <p className="mb-4 text-sm text-destructive">{loadError}</p>}

      {asset && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Assigné à&nbsp;:
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
      {canCreate && (
        <Button className="mb-4" onClick={() => void createVersion()}>
          + Nouvelle version
        </Button>
      )}

      <VersionTimeline
        versions={versions}
        isLoading={isLoading}
        canCreate={canCreate}
        canPublish={canPublish}
        contextKey={`asset:${assetId}`}
        projectId={asset?.projectId ?? null}
        emptyDescription={
          canCreate
            ? 'Créez une première version ou déposez un média pour démarrer l’historique de cet asset.'
            : 'Aucune version publiée pour cet asset.'
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
