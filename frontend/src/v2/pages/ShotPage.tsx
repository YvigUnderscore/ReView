// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import Shell from '../components/Shell';
import EntityBreadcrumb from '../components/EntityBreadcrumb';
import FavoriteButton from '../components/FavoriteButton';
import { SkeletonRows } from '../components/ui/skeleton';
import AssetLatestCard from './asset/AssetLatestCard';
import TaskCards from './asset/AssetTaskCards';
import ShotAssets from './shot/ShotAssets';
import TaskPickerDialog from '../components/upload/TaskPickerDialog';
import { Button } from '../components/ui/button';
import PipelineStatusBadge from '../components/shotgrid/PipelineStatusBadge';
import SgSyncDot from '../components/shotgrid/SgSyncDot';
import { useT } from '../i18n';
import type { AssetOverview } from '../types/api';
import { useAuth } from '../stores/useAuth';

/** Détail d'un plan tel que `GET /api/shots/:id` le renvoie. */
interface ShotDetail {
  id: number;
  code: string;
  name: string;
  projectId?: number;
  pipelineStatusId?: number | null;
  thumbnailUrl?: string | null;
  sequence?: { id: number; code: string; projectId?: number } | null;
}

/**
 * Le plan, comme page.
 *
 * Un plan s'ouvrait dans un tiroir latéral, tandis qu'un asset avait sa page : le même
 * travail — des étapes, des tâches, des versions — se lisait donc de deux façons, dans
 * deux largeurs, avec deux façons d'y revenir. Cette page reprend l'agencement de celle
 * d'un asset, au détail près de ce qu'un plan n'a pas.
 *
 * Une version ne peut pendre que d'une tâche ou d'un asset — jamais d'un plan. « Nouvelle
 * version » demande donc d'abord sous quelle étape, exactement comme sur un asset ; le
 * sélecteur sait créer la tâche si elle manque encore. Il n'y a pas ici de « versions
 * rattachées directement », parce que la base n'en veut pas.
 */
export default function ShotPage() {
  const { id } = useParams();
  const shotId = Number(id);
  const t = useT();
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);

  const shotQ = useQuery({
    queryKey: qk.shot(shotId),
    queryFn: () => api.get<{ shot: ShotDetail }>(`/api/shots/${shotId}`),
  });
  const shot = shotQ.data?.shot ?? null;
  const projectId = shot?.sequence?.projectId ?? shot?.projectId ?? 0;
  const role = useAuth((s) => s.user?.role);
  const canManage = role === 'ADMIN' || role === 'SUPERVISOR';

  const treeQ = useQuery({
    queryKey: qk.shotTree(shotId),
    queryFn: () => api.get<AssetOverview>(`/api/shots/${shotId}/tree`),
    enabled: shotId > 0,
  });
  const overview = treeQ.data ?? null;

  /** Tâches du plan, telles que l'arbre les a déjà chargées. */
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

  const createVersion = async (taskId: number | null) => {
    if (!taskId) return;
    try {
      const { version } = await api.post<{ version: { id: number; name: string } }>('/api/versions', {
        taskId,
      });
      toast.success(t('version.created', { name: version.name }));
      // La version vit sous sa tâche : c'est là qu'on dépose son média et qu'on publie.
      void navigate(`/tasks/${taskId}?version=${version.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('version.createFailed'));
    }
  };

  return (
    <Shell breadcrumb={<EntityBreadcrumb entity="shot" id={shotId} />}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">
            {shot ? shot.code : `${t('shots.title')} #${shotId}`}
            {shot?.name && shot.name !== shot.code && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">{shot.name}</span>
            )}
          </h1>
          <PipelineStatusBadge statusId={shot?.pipelineStatusId} scope="shot" />
          <SgSyncDot projectId={projectId} type="shot" localId={shotId} canRealign={canManage} />
          <FavoriteButton type="SHOT" entityId={shotId} size={18} />
        </div>
        <div className="flex items-center gap-4 text-sm">
          {shot?.sequence && <span className="text-muted-foreground">{shot.sequence.code}</span>}
          <Link to="/projects" className="text-muted-foreground hover:text-foreground">
            {t('nav.backToProjects')}
          </Link>
        </div>
      </div>

      {shotQ.error && <p className="mb-4 text-sm text-destructive">{shotQ.error.message}</p>}

      {shot?.thumbnailUrl && (
        <img
          src={shot.thumbnailUrl}
          alt=""
          className="mb-4 h-40 w-full rounded-lg border border-border object-cover"
        />
      )}

      {overview?.latest && <AssetLatestCard assetId={shotId} latest={overview.latest} />}

      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('asset.tree.title')}</h2>
        {role !== 'CLIENT' && (
          <Button size="sm" onClick={() => setPicking(true)}>
            {t('version.newPlus')}
          </Button>
        )}
      </div>
      {treeQ.isLoading ? (
        <SkeletonRows count={3} />
      ) : (
        <TaskCards groups={overview?.groups ?? []} projectId={projectId} entityType="Shot" />
      )}

      <TaskPickerDialog
        open={picking}
        onOpenChange={setPicking}
        tasks={pickableTasks}
        projectId={projectId}
        parent={{ kind: 'shot', id: shotId }}
        onPick={(taskId) => void createVersion(taskId)}
      />

      <div className="mt-6">
        <ShotAssets shotId={shotId} projectId={projectId} canManage={canManage} />
      </div>
    </Shell>
  );
}
