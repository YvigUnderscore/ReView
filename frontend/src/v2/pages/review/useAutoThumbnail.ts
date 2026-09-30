// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { MediaResp } from './reviewTypes';
import type { MediaKind } from '../../types/api';

/**
 * Miniature **auto** (Phase 20) : pas de rendu headless serveur pour les médias 3D/splat →
 * on capture le rendu client à la 1re visualisation **si aucune miniature n'existe**, et on
 * l'envoie via `POST /api/media/:id/auto-thumbnail` (bootstrap idempotent côté backend, ouvert à
 * tout membre du projet). Best-effort et silencieux ; une seule tentative par montage.
 */
export function useAutoThumbnail(
  id: number,
  data: MediaResp | null,
  kind: MediaKind,
  ready: boolean,
  capture: () => Promise<string | null>,
): void {
  const qc = useQueryClient();
  const doneRef = useRef(false);

  useEffect(() => {
    if (doneRef.current || !ready || data?.media.kind !== kind || data?.thumbnailUrl) return;
    doneRef.current = true;
    const t = setTimeout(() => {
      void (async () => {
        const dataUrl = await capture();
        if (!dataUrl) return;
        try {
          const { thumbnailUrl } = await api.post<{ thumbnailUrl: string | null }>(
            `/api/media/${id}/auto-thumbnail`,
            { dataUrl },
          );
          if (thumbnailUrl) {
            qc.setQueryData<MediaResp>(qk.media(id), (old) => (old ? { ...old, thumbnailUrl } : old));
          }
        } catch {
          // best-effort : miniature silencieuse
        }
      })();
    }, 600);
    return () => clearTimeout(t);
  }, [id, data, kind, ready, capture, qc]);
}
