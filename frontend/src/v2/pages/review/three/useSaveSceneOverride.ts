// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { useT } from '../../../i18n';

/**
 * Saves the USD scene override as the **media's base** (46.D): what the manager sees becomes what
 * everyone will see. Reserved for managers and refused after publication (P11 lock, checked
 * server-side) — the hook then exposes no action.
 *
 * Extracted from `Model3DReview` (line budget): the orchestrator only keeps the wiring.
 */
export function useSaveSceneOverride(params: {
  mediaId: number;
  allowed: boolean;
  /** Merged override to send (base + local exploration). */
  merged: () => unknown;
  /** Resets the local exploration to zero once the base is saved. */
  onSaved: () => void;
}) {
  const { mediaId, allowed, merged, onSaved } = params;
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const run = useCallback(() => {
    setBusy(true);
    api
      .put(`/api/media/${mediaId}/usd/override`, { override: merged() })
      .then(() => {
        toast.success(t('review.staging.saved'));
        void qc.invalidateQueries({ queryKey: qk.media(mediaId) });
        onSaved();
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : t('common.error.save')))
      .finally(() => setBusy(false));
  }, [mediaId, merged, onSaved, qc, t]);

  return { busy, run: allowed ? run : undefined };
}
