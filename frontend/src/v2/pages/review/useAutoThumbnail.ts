// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { MediaResp } from './reviewTypes';
import type { MediaKind } from '../../types/api';

/**
 * **Auto** thumbnail (Phase 20): no server-side headless render for 3D/splat media → we capture the
 * client-side render at the first view **if no thumbnail exists**, and send it via
 * `POST /api/media/:id/auto-thumbnail` (idempotent bootstrap on the backend, open to any project
 * member). Best-effort and silent; a single attempt per mount.
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
          // best-effort: silent thumbnail
        }
      })();
    }, 600);
    return () => clearTimeout(t);
  }, [id, data, kind, ready, capture, qc]);
}
