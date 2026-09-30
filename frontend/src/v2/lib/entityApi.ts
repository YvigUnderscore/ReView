// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from './query';
import { ENTITY_SEGMENT, type EntityKind } from '../components/entity/entitySettings';
import { useT } from '../i18n';

/**
 * Fiche d'une entité de pipe (C3) — réglages et vignette.
 *
 * La vignette se dépose en deux temps, comme un avatar : le serveur signe une URL et
 * calcule la clé, on téléverse vers MinIO, puis on enregistre. La clé n'est jamais
 * choisie par le client — le PATCH l'acceptait, et rien n'empêchait d'y écrire celle
 * d'un média appartenant à un autre projet.
 */

/** Invalide tout ce qui montre l'entité : sa fiche, la liste dont elle vient, ses vignettes. */
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
      const { url, key } = await api.post<{ url: string; key: string }>(
        `/api/${segment}/${id}/thumbnail/presign`,
        { contentType: file.type },
      );
      const res = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      // Le dépôt va directement vers MinIO : l'échec ne passe pas par notre client HTTP,
      // et se retrouverait sans message si on ne le formulait pas ici.
      if (!res.ok) throw new Error(t('common.error.upload'));
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
