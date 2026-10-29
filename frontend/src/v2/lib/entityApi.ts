// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { ENTITY_SEGMENT, type EntityKind } from '../components/entity/entitySettings';
import { useT } from '../i18n';
import { presignAndUpload } from '@/v2/lib/presignedUpload';

/**
 * Record of a pipeline entity (C3) — settings and thumbnail.
 *
 * The thumbnail is uploaded in two steps, like an avatar: the server signs a URL and computes the
 * key, we upload to MinIO, then we save. The key is never chosen by the client — the PATCH used to
 * accept it, and nothing prevented writing into it the key of a media belonging to another project.
 */

/** Invalidates everything that shows the entity: its record, the list it comes from, its thumbnails. */
function entityQueryKeys(kind: EntityKind, id: number, projectId: number) {
  const own = kind === 'sequence' ? qk.sequence(id) : kind === 'shot' ? qk.shot(id) : qk.asset(id);
  const list =
    kind === 'sequence'
      ? qk.sequences(projectId)
      : kind === 'shot'
        ? qk.shots(projectId)
        : qk.assets(projectId);
  return [own, list];
}

export function useUpdateEntity(kind: EntityKind, id: number, projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.patch(`/api/${ENTITY_SEGMENT[kind]}/${id}`, payload),
    onSuccess: () => {
      for (const key of entityQueryKeys(kind, id, projectId)) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useSetEntityThumbnail(kind: EntityKind, id: number, projectId: number) {
  const qc = useQueryClient();
  const t = useT();
  const segment = ENTITY_SEGMENT[kind];
  return useMutation({
    mutationFn: async (file: File | null) => {
      if (file === null) {
        await api.put(`/api/${segment}/${id}/thumbnail`, { key: null });
        return null;
      }
      const { key } = await presignAndUpload(
        `/api/${segment}/${id}/thumbnail/presign`,
        { contentType: file.type },
        file,
        t('common.error.upload'),
      );
      await api.put(`/api/${segment}/${id}/thumbnail`, { key });
      return key;
    },
    onSuccess: () => {
      for (const key of entityQueryKeys(kind, id, projectId)) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}
