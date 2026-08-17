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

  // L'arbre d'un asset (Phase 45) dépend des versions de ses tâches : publier depuis une
  // tâche doit rafraîchir la page de l'asset, qui n'est pas celle où l'on se trouve.
  const invalidateVersions = async () => {
    await qc.invalidateQueries({ queryKey: versionsKey });
    void qc.invalidateQueries({ queryKey: ['asset'] });
  };

  // Un upload terminé rafraîchit la liste des versions + les médias de chaque version.
  useEffect(() => {
    if (uploads.some((u) => u.status === 'done')) {
      void qc.invalidateQueries({ queryKey: qk.versions(filter) });
      void qc.invalidateQueries({ queryKey: ['version'] });
      void qc.invalidateQueries({ queryKey: ['asset'] });
    }
  }, [uploads, qc, filter]);

  /**
   * Crée la version suivante.
   *
   * `destination` permet de ranger la version sous une tâche précise plutôt que sous le
   * parent où l'on se trouve : c'est ce que demande un pipe découpé en étapes, où un
   * rendu appartient au texturing, pas « à l'asset » en général.
   */
  const createVersion = async (destination?: { taskId: number }): Promise<Version | null> => {
    try {
      const body = destination ? { taskId: destination.taskId } : createBody;
      const { version } = await api.post<{ version: Version }>('/api/versions', body);
      toast.success(t('version.created', { name: version.name }));
      await invalidateVersions();
      return version;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('version.createFailed'));
      return null;
    }
  };
  /**
   * Publie la version ET tous ses brouillons d'un geste (Phase 46) : c'était quatre clics
   * pour une seule intention. La version bascule publiée dès qu'il ne lui reste plus un
   * brouillon — le serveur s'en charge.
   */
  const publishVersion = async (vid: number) => {
    try {
      await api.post(`/api/versions/${vid}/publish`, {});
      toast.success(t('version.published'));
      await invalidateVersions();
      void qc.invalidateQueries({ queryKey: qk.version(vid) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.publish'));
    }
  };
  const publishMedia = async (versionId: number, mediaId: number) => {
    try {
      await api.post(`/api/media/${mediaId}/publish`);
      toast.success(t('media.publishedTeam'));
      void qc.invalidateQueries({ queryKey: qk.version(versionId) });
      void invalidateVersions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.publish'));
    }
  };
  const removeVersion = async (vid: number) => {
    try {
      await api.del(`/api/versions/${vid}`);
      toast.success(t('version.trashed'));
      await invalidateVersions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.delete'));
    }
  };
  const removeMedia = async (versionId: number, mediaId: number) => {
    try {
      await api.del(`/api/media/${mediaId}`);
      toast.success(t('media.trashed'));
      void qc.invalidateQueries({ queryKey: qk.version(versionId) });
      void invalidateVersions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.delete'));
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
