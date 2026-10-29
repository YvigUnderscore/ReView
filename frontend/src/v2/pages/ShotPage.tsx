// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListPlus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { deliverFiles } from '../stores/deliverFiles';
import EntityWorkPage from '../components/entity/EntityWorkPage';
import FullPageDropzone from '../components/FullPageDropzone';
import { SkeletonRows } from '../components/ui/skeleton';
import AssetLatestCard from './asset/AssetLatestCard';
import TaskCards from './asset/AssetTaskCards';
import ShotAssets from './shot/ShotAssets';
import TaskPickerDialog from '../components/upload/TaskPickerDialog';
import NewTaskDialog from '../components/entity/NewTaskDialog';
import { Button } from '../components/ui/button';
import { useProjectRole } from '../lib/useProjectRole';
import { useAddToPlaylistMenu } from '../lib/useAddToPlaylistMenu';
import { useStatusMenu } from '../lib/useStatusMenu';
import { useOmitMenu } from '../lib/useOmitMenu';
import { entriesOf } from '../lib/menuSpec';
import type { MenuEntry } from '../lib/menuSpec';
import { useMarkVisited } from '../lib/useVisits';
import { useT } from '../i18n';
import type { AssetOverview } from '../types/api';
import EntityUnavailable from '../components/EntityUnavailable';
import { isBadId, isMissingOrForbidden } from '../components/entityAvailability';

/** Detail of a shot as returned by `GET /api/shots/:id`. */
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
  /** Cut at mount (Phase 45): automatic edits skip it, this one stays whole. */
  omitted?: boolean;
  sequence?: { id: number; code: string; projectId?: number } | null;
}

/**
 * The shot, as a page.
 *
 * A version can only hang from a task or an asset, never from a shot. Dropping a
 * file therefore first asks under which step, exactly as on an asset; the
 * selector can create the task if it is still missing. The drop was missing here although it
 * existed on an asset: the same gesture failed depending on the entity opened (C3).
 */
export default function ShotPage() {
  const { id } = useParams();
  const shotId = Number(id);
  // Opening is consulting: the "not consulted" glow switches off here (batch 9).
  useMarkVisited('SHOT', shotId);
  const t = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pending, setPending] = useState<File[] | 'empty' | null>(null);
  const [newTask, setNewTask] = useState(false);

  const shotQ = useQuery({
    queryKey: qk.shot(shotId),
    queryFn: () => api.get<{ shot: ShotDetail }>(`/api/shots/${shotId}`),
  });
  const shot = shotQ.data?.shot ?? null;
  const projectId = shot?.sequence?.projectId ?? shot?.projectId ?? 0;
  const { canManage, canContribute } = useProjectRole(projectId);
  const playlistMenu = useAddToPlaylistMenu(projectId);
  const { entry: statusEntry } = useStatusMenu(projectId, 'shot');
  const { entry: omitEntry } = useOmitMenu(projectId);

  const treeQ = useQuery({
    queryKey: qk.shotTree(shotId),
    queryFn: () => api.get<AssetOverview>(`/api/shots/${shotId}/tree`),
    enabled: shotId > 0,
  });
  const overview = treeQ.data ?? null;

  /** Tasks of the shot, as the tree has already loaded them. */
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

  const fill = async (taskId: number, send?: (versionId: number) => void) => {
    try {
      const { version } = await api.post<{ version: { id: number; name: string } }>('/api/versions', {
        taskId,
      });
      send?.(version.id);
      toast.success(t('version.created', { name: version.name }));
      // The version lives under its task: that is where its media is dropped and published.
      void navigate(`/tasks/${taskId}?version=${version.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('version.createFailed'));
    }
  };

  const withTask = (files: File[] | 'empty', taskId: number | null) => {
    if (!taskId) return;
    // Grouping and instruction are decided BEFORE creating the version: an abandoned drop
    // must not leave an empty version behind (Phase 50).
    if (files === 'empty') return fill(taskId);
    return deliverFiles(projectId, files, (send) => fill(taskId, send));
  };

  // "Add to playlist" on the latest published version: that is the one pushed
  // into the dailies, not the shot's history.
  const latestVersionId = overview?.latest?.versionId ?? null;
  const playlistEntry = latestVersionId ? playlistMenu.entry({ versionIds: [latestVersionId] }) : null;

  const menuExtras: MenuEntry[] = [
    // Shot status, at the top of the menu: it is what one changes most often.
    ...entriesOf(shot ? statusEntry(shot, { canEdit: canManage }) : null),
    // Omitting the edit: it only touches automatic edits, the shot keeps
    // everything — hence the checkbox rather than an action with a permanent name.
    ...entriesOf(shot ? omitEntry(shot, { canEdit: canManage }) : null),
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
    // Setting a step on the shot: the gesture only existed indirectly — by requesting
    // a version, or by assigning someone — and not at all without ShotGrid.
    ...(canManage
      ? [
          {
            id: 'new-task',
            label: t('task.new'),
            icon: <ListPlus size={14} />,
            onSelect: () => setNewTask(true),
          },
        ]
      : []),
    ...(playlistEntry ? [playlistEntry] : []),
  ];

  // An unusable identifier or a missing entity used to render the full
  // shell, with active actions on a subject that does not exist.
  if (isBadId(shotId) || (shotQ.isError && isMissingOrForbidden(shotQ.error)))
    return <EntityUnavailable kind="shot" error={isBadId(shotId) ? undefined : shotQ.error} />;
  if (shotQ.isError)
    return <EntityUnavailable kind="shot" error={shotQ.error} onRetry={() => void shotQ.refetch()} />;

  return (
    <EntityWorkPage
      kind="shot"
      id={shotId}
      projectId={projectId}
      // Waiting title, until the sheet arrives. It said "Shots #21" — the title of the
      // LIST, in plural, for a single shot. The identifier alone lies about nothing and
      // has no grammatical form to agree in fourteen languages.
      title={shot ? shot.code : `#${shotId}`}
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
      {shot?.description && (
        <p className="mb-5 max-w-3xl whitespace-pre-line text-sm text-muted-foreground">{shot.description}</p>
      )}

      {overview?.latest && <AssetLatestCard assetId={shotId} entity="shot" latest={overview.latest} />}

      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t('asset.tree.title')}</h2>
      {treeQ.isLoading ? (
        <SkeletonRows count={3} />
      ) : (
        <TaskCards
          groups={overview?.groups ?? []}
          projectId={projectId}
          entityType="Shot"
          onNewTask={canManage ? () => setNewTask(true) : undefined}
        />
      )}

      <NewTaskDialog
        open={newTask}
        onOpenChange={setNewTask}
        projectId={projectId}
        parent={{ kind: 'shot', id: shotId }}
        onCreated={() => void qc.invalidateQueries({ queryKey: qk.shotTree(shotId) })}
      />

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
