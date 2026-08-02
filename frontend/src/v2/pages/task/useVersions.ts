// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useUploadStore } from '../../../stores/useUploadStore';
import type { Version, VersionListItem } from '../../types/api';
import { useT } from '../../i18n';

/** Portée d'une timeline de versions : rattachée à une tâche OU à un asset. */
export type VersionScope = { taskId: number } | { assetId: number };

/**
 * Données + mutations d'une timeline de versions, **partagées par TaskPage et AssetPage**
 * (Phase 20). Lectures via Query ; chaque mutation invalide les clés concernées + toast.
 */
export function useVersions(scope: VersionScope) {
  const t = useT();
  const qc = useQueryClient();
  const uploads = useUploadStore((s) => s.uploads);
  const filter = 'taskId' in scope ? `taskId=${scope.taskId}` : `assetId=${scope.assetId}`;
  const createBody = 'taskId' in scope ? { taskId: scope.taskId } : { assetId: scope.assetId };
  const versionsKey = qk.versions(filter);

  const versionsQ = useQuery({
    queryKey: versionsKey,
    queryFn: () =>
      api.get<{ versions: VersionListItem[] }>(`/api/versions?${filter}`).then((d) => d.versions),
  });

  const invalidateVersions = () => qc.invalidateQueries({ queryKey: versionsKey });

  // Un upload terminé rafraîchit la liste des versions + les médias de chaque version.
  useEffect(() => {
    if (uploads.some((u) => u.status === 'done')) {
      qc.invalidateQueries({ queryKey: qk.versions(filter) });
      qc.invalidateQueries({ queryKey: ['version'] });
    }
  }, [uploads, qc, filter]);

  const createVersion = async (): Promise<Version | null> => {
    try {
      const { version } = await api.post<{ version: Version }>('/api/versions', createBody);
      toast.success(`Version « ${version.name} » créée`);
      await invalidateVersions();
      return version;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('version.createFailed'));
      return null;
    }
  };
  const publishVersion = async (vid: number) => {
    try {
      await api.patch(`/api/versions/${vid}`, { status: 'PUBLISHED' });
      toast.success(t('version.published'));
      invalidateVersions();
      qc.invalidateQueries({ queryKey: qk.version(vid) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Publication impossible');
    }
  };
  const publishMedia = async (versionId: number, mediaId: number) => {
    try {
      await api.post(`/api/media/${mediaId}/publish`);
      toast.success(t('media.publishedTeam'));
      qc.invalidateQueries({ queryKey: qk.version(versionId) });
      invalidateVersions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Publication impossible');
    }
  };
  const removeVersion = async (vid: number) => {
    try {
      await api.del(`/api/versions/${vid}`);
      toast.success(t('version.trashed'));
      await invalidateVersions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Suppression impossible');
    }
  };
  const removeMedia = async (versionId: number, mediaId: number) => {
    try {
      await api.del(`/api/media/${mediaId}`);
      toast.success(t('media.trashed'));
      qc.invalidateQueries({ queryKey: qk.version(versionId) });
      invalidateVersions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Suppression impossible');
    }
  };

  return {
    versions: versionsQ.data ?? [],
    isLoading: versionsQ.isLoading,
    loadError: versionsQ.error?.message ?? null,
    createVersion,
    publishVersion,
    publishMedia,
    removeVersion,
    removeMedia,
  };
}
