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

/** Scope of a version timeline: attached to a task OR to an asset. */
export type VersionScope = { taskId: number } | { assetId: number };

/**
 * Data + mutations of a version timeline, **shared by TaskPage and AssetPage** (Phase 20). Reads
 * go through Query; each mutation invalidates the relevant keys and shows a toast.
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

  // An asset's tree (Phase 45) depends on the versions of its tasks: publishing from a task must
  // refresh the asset page, which is not the one we are on.
  const invalidateVersions = async () => {
    await qc.invalidateQueries({ queryKey: versionsKey });
    void qc.invalidateQueries({ queryKey: ['asset'] });
  };

  // A finished upload refreshes the list of versions + the media of each version.
  useEffect(() => {
    if (uploads.some((u) => u.status === 'done')) {
      void qc.invalidateQueries({ queryKey: qk.versions(filter) });
      void qc.invalidateQueries({ queryKey: ['version'] });
      void qc.invalidateQueries({ queryKey: ['asset'] });
    }
  }, [uploads, qc, filter]);

  /**
   * Creates the next version.
   *
   * `destination` lets the version be filed under a specific task rather than under the parent we
   * are on: this is what a pipeline split into steps requires, where a render belongs to texturing,
   * not "to the asset" in general.
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
   * Publishes the version AND all its drafts in one gesture (Phase 46): it used to take four clicks
   * for a single intention. The version switches to published as soon as no draft is left — the
   * server handles it.
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
