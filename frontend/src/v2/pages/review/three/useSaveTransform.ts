// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { useT } from '../../../i18n';
import type { Transform } from '../reviewTypes';

/**
 * Écrit la transformation de la version puis relâche l'édition locale : extrait de
 * `useModel3DThree` qui dépassait son budget de lignes.
 */
export function useSaveTransform(
  versionId: number | null | undefined,
  transform: Transform,
  onSaved: () => void,
): () => Promise<void> {
  const t = useT();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    if (!versionId) return;
    try {
      await api.patch(`/api/versions/${versionId}`, { transform });
      await queryClient.invalidateQueries({ queryKey: qk.version(versionId) });
      onSaved();
      toast.success(t('model3d.transformSaved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('model3d.transformSaveFailed'));
    }
  }, [versionId, transform, queryClient, onSaved, t]);
}
