import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { useUploadStore } from '../../../stores/useUploadStore';
import type { TaskDetail, Version, VersionListItem } from '../../types/api';

/**
 * Données et mutations d'une tâche pour la timeline de versions (10.C3).
 * Lectures via Query (une clé = une shape) ; chaque mutation invalide les clés
 * concernées et produit un toast (feedback obligatoire).
 */
export function useTaskVersions(taskId: number) {
  const qc = useQueryClient();
  const uploads = useUploadStore((s) => s.uploads);
  const versionsKey = qk.versions(`taskId=${taskId}`);

  const taskQ = useQuery({
    queryKey: qk.task(taskId),
    queryFn: () => api.get<{ task: TaskDetail }>(`/api/tasks/${taskId}`).then((d) => d.task),
  });
  const versionsQ = useQuery({
    queryKey: versionsKey,
    queryFn: () =>
      api.get<{ versions: VersionListItem[] }>(`/api/versions?taskId=${taskId}`).then((d) => d.versions),
  });

  const invalidateVersions = () => qc.invalidateQueries({ queryKey: versionsKey });

  // Un upload terminé rafraîchit la liste des versions + les médias de chaque version.
  // (deps sur taskId, stable — versionsKey est recalculé à chaque render.)
  useEffect(() => {
    if (uploads.some((u) => u.status === 'done')) {
      qc.invalidateQueries({ queryKey: qk.versions(`taskId=${taskId}`) });
      qc.invalidateQueries({ queryKey: ['version'] });
    }
  }, [uploads, qc, taskId]);

  const createVersion = async (): Promise<Version | null> => {
    try {
      const { version } = await api.post<{ version: Version }>('/api/versions', { taskId });
      toast.success(`Version « ${version.name} » créée`);
      await invalidateVersions();
      return version;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Création impossible');
      return null;
    }
  };
  const publishVersion = async (vid: number) => {
    try {
      await api.patch(`/api/versions/${vid}`, { status: 'PUBLISHED' });
      toast.success('Version publiée');
      invalidateVersions();
      qc.invalidateQueries({ queryKey: qk.version(vid) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Publication impossible');
    }
  };
  const publishMedia = async (versionId: number, mediaId: number) => {
    try {
      await api.post(`/api/media/${mediaId}/publish`);
      toast.success('Média publié pour l’équipe');
      qc.invalidateQueries({ queryKey: qk.version(versionId) });
      invalidateVersions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Publication impossible');
    }
  };
  const removeVersion = async (vid: number) => {
    try {
      await api.del(`/api/versions/${vid}`);
      toast.success('Version déplacée dans la corbeille');
      await invalidateVersions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Suppression impossible');
    }
  };
  const removeMedia = async (versionId: number, mediaId: number) => {
    try {
      await api.del(`/api/media/${mediaId}`);
      toast.success('Média déplacé dans la corbeille');
      qc.invalidateQueries({ queryKey: qk.version(versionId) });
      invalidateVersions();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Suppression impossible');
    }
  };

  return {
    task: taskQ.data ?? null,
    versions: versionsQ.data ?? [],
    isLoading: taskQ.isLoading || versionsQ.isLoading,
    loadError: (taskQ.error ?? versionsQ.error)?.message ?? null,
    createVersion,
    publishVersion,
    publishMedia,
    removeVersion,
    removeMedia,
  };
}
