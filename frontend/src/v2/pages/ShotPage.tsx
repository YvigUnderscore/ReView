// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useUploadStore } from '../../stores/useUploadStore';
import EntityWorkPage from '../components/entity/EntityWorkPage';
import FullPageDropzone from '../components/FullPageDropzone';
import { SkeletonRows } from '../components/ui/skeleton';
import AssetLatestCard from './asset/AssetLatestCard';
import TaskCards from './asset/AssetTaskCards';
import ShotAssets from './shot/ShotAssets';
import TaskPickerDialog from '../components/upload/TaskPickerDialog';
import { Button } from '../components/ui/button';
import { useProjectRole } from '../lib/useProjectRole';
import { useAddToPlaylistMenu } from '../lib/useAddToPlaylistMenu';
import type { MenuEntry } from '../lib/menuSpec';
import { useT } from '../i18n';
import type { AssetOverview } from '../types/api';

/** Détail d'un plan tel que `GET /api/shots/:id` le renvoie. */
interface ShotDetail {
  id: number;
  code: string;
  name: string;
  projectId?: number;
  description?: string | null;
  startFrame?: number | null;
  endFrame?: number | null;
  pipelineStatusId?: number | null;
  thumbnailUrl?: string | null;
  sequence?: { id: number; code: string; projectId?: number } | null;
}

/**
 * Le plan, comme page.
 *
 * Une version ne peut pendre que d'une tâche ou d'un asset — jamais d'un plan. Déposer un
 * fichier demande donc d'abord sous quelle étape, exactement comme sur un asset ; le
 * sélecteur sait créer la tâche si elle manque encore. Le dépôt manquait ici alors qu'il
 * existait sur un asset : le même geste échouait selon l'entité ouverte (C3).
 */
export default function ShotPage() {
  const { id } = useParams();
  const shotId = Number(id);
  const t = useT();
  const navigate = useNavigate();
  const enqueue = useUploadStore((s) => s.enqueue);
  const [pending, setPending] = useState<File[] | 'empty' | null>(null);

  const shotQ = useQuery({
    queryKey: qk.shot(shotId),
    queryFn: () => api.get<{ shot: ShotDetail }>(`/api/shots/${shotId}`),
  });
  const shot = shotQ.data?.shot ?? null;
  const projectId = shot?.sequence?.projectId ?? shot?.projectId ?? 0;
  const { canManage, canContribute } = useProjectRole(projectId);
  const playlistMenu = useAddToPlaylistMenu(projectId);

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

  const withTask = async (files: File[] | 'empty', taskId: number | null) => {
    if (!taskId) return;
    try {
      const { version } = await api.post<{ version: { id: number; name: string } }>('/api/versions', {
        taskId,
      });
      if (files !== 'empty') files.forEach((f) => enqueue(f, version.id));
      toast.success(t('version.created', { name: version.name }));
      // La version vit sous sa tâche : c'est là qu'on dépose son média et qu'on publie.
      void navigate(`/tasks/${taskId}?version=${version.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('version.createFailed'));
    }
  };

  // « Ajouter à la playlist » sur la dernière version publiée : c'est elle qu'on pousse
  // dans les dailies, pas l'historique du plan.
  const latestVersionId = overview?.latest?.versionId ?? null;
  const playlistEntry = latestVersionId ? playlistMenu.entry({ versionIds: [latestVersionId] }) : null;

  const menuExtras: MenuEntry[] = [
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
    ...(playlistEntry ? [playlistEntry] : []),
  ];

  return (
    <EntityWorkPage
      kind="shot"
      id={shotId}
      projectId={projectId}
      title={shot ? shot.code : `${t('shots.title')} #${shotId}`}
      subtitle={shot?.name && shot.name !== shot.code ? shot.name : null}
      entity={shot ?? {}}
      thumbnailUrl={shot?.thumbnailUrl}
      statusId={shot?.pipelineStatusId}
      canManage={canManage}
      menuExtras={menuExtras}
      actions={
        canContribute && (
          <Button size="sm" onClick={() => setPending('empty')}>
            {t('version.newPlus')}
          </Button>
        )
      }
    >
      {shotQ.error && <p className="mb-4 text-sm text-destructive">{shotQ.error.message}</p>}
      {shot?.description && (
        <p className="mb-5 max-w-3xl whitespace-pre-line text-sm text-muted-foreground">{shot.description}</p>
      )}

      {overview?.latest && <AssetLatestCard assetId={shotId} entity="shot" latest={overview.latest} />}

      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t('asset.tree.title')}</h2>
      {treeQ.isLoading ? (
        <SkeletonRows count={3} />
      ) : (
        <TaskCards groups={overview?.groups ?? []} projectId={projectId} entityType="Shot" />
      )}

      <TaskPickerDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        tasks={pickableTasks}
        projectId={projectId}
        parent={{ kind: 'shot', id: shotId }}
        onPick={(taskId) => {
          const files = pending;
          setPending(null);
          if (files !== null) void withTask(files, taskId);
        }}
      />

      <div className="mt-6">
        <ShotAssets shotId={shotId} projectId={projectId} canManage={canManage} />
      </div>

      {canContribute && (
        <FullPageDropzone onDrop={(files) => setPending(files)} label={t('version.dropShot')} />
      )}
    </EntityWorkPage>
  );
}
