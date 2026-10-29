// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/apiClient';
import type { SplatEdits, SplatEditsPatch } from '@/v2/pages/review/reviewTypes';
import type { SplatViewer } from '../../useSplat';
import { applyMaskIndices, fetchMaskIndices } from './applyEdits';
import { bytesToBase64, encodeMask } from './mask';
import { applySubsetOps, encodeSubsetOps, fetchSubsetOps, type SubsetOp } from './subsetOps';
import { useT } from '@/v2/i18n';

/**
 * Persistence of splat edits (extracted from `useSplatEditor` to keep its size in check):
 * reloading the persisted binary edits (deletion mask, subset transforms, Phase 28) and saving or
 * resetting them on the server (JSON + binaries). The edited state (transform, volumes, op log)
 * stays in the editor; this hook only serializes it to the API and replays what was saved on load.
 */
export function useSplatPersistence(opts: {
  splat: SplatViewer;
  mediaId: number;
  enabled: boolean;
  savedMaskUrl: string | null;
  savedSubsetUrl: string | null;
  /** Cumulative mask (masked indices), filled here on load and read on save. */
  deletedRef: RefObject<Set<number>>;
  /** Subset op log, filled here on load and read on save. */
  subsetOpsRef: RefObject<SubsetOp[]>;
  setDeletedCount: (n: number) => void;
  notifyHiddenChanged: (indices: Iterable<number>) => void;
  /** Serializes the current state (transform + volumes + baseFlip) when saving. */
  buildEdits: () => SplatEdits;
  /**
   * Binary volumes ALREADY saved on the media, recorded here on load (Phase 50, lot 14).
   *
   * This distinguishes what the author added from what they merely found: a proposal attached
   * to a comment must carry only its own gesture, otherwise each note would replay on the
   * reader's cloud the ops already applied on theirs.
   */
  basesRef: RefObject<{ mask: number; subset: number }>;
  onSaved: (patch: SplatEditsPatch) => void;
  onClean: () => void;
}) {
  const t = useT();
  const { splat, mediaId, enabled, savedMaskUrl, savedSubsetUrl, deletedRef, subsetOpsRef } = opts;
  const { setDeletedCount, notifyHiddenChanged, buildEdits, basesRef, onSaved, onClean } = opts;
  const { ready } = splat;
  const [busy, setBusy] = useState(false);
  const maskInitRef = useRef(false);
  const subsetInitRef = useRef(false);

  // Reloads the persisted mask (once): applied to the display and counter initialized, so that
  // subsequent deletions accumulate onto it on save.
  useEffect(() => {
    if (!enabled || !ready || maskInitRef.current || !savedMaskUrl) return;
    maskInitRef.current = true;
    const handle = splat.getSceneHandle();
    if (!handle) return;
    fetchMaskIndices(savedMaskUrl)
      .then((indices) => {
        deletedRef.current = applyMaskIndices(handle, indices);
        basesRef.current.mask = deletedRef.current.size;
        setDeletedCount(deletedRef.current.size);
        notifyHiddenChanged(deletedRef.current);
      })
      .catch(() => toast.error(t('splat.maskUnreadable')));
  }, [enabled, ready, savedMaskUrl, splat, deletedRef, basesRef, setDeletedCount, notifyHiddenChanged, t]);

  // Reloads the persisted subset transforms (once): replayed on the packed data and op log
  // initialized, so that subsequent ops accumulate onto it.
  useEffect(() => {
    if (!enabled || !ready || subsetInitRef.current || !savedSubsetUrl) return;
    subsetInitRef.current = true;
    const handle = splat.getSceneHandle();
    if (!handle) return;
    fetchSubsetOps(savedSubsetUrl)
      .then((ops) => {
        applySubsetOps(handle, ops);
        subsetOpsRef.current = ops;
        basesRef.current.subset = ops.length;
      })
      .catch(() => toast.error(t('splat.transformUnreadable')));
  }, [enabled, ready, savedSubsetUrl, splat, subsetOpsRef, basesRef, t]);

  /** Saves all edits: transform + volumes (JSON), mask and binary ops. */
  const save = useCallback(async () => {
    setBusy(true);
    try {
      const { splatEdits } = await api.patch<{ splatEdits: SplatEdits | null }>(
        `/api/media/${mediaId}/splat-edits`,
        { edits: buildEdits() },
      );
      const patch: SplatEditsPatch = { splatEdits };
      const deleted = deletedRef.current;
      if (deleted.size > 0) {
        const mask = await api.put<{ splatMaskUrl: string; splatMaskCount: number }>(
          `/api/media/${mediaId}/splat-mask`,
          { data: bytesToBase64(encodeMask(deleted)), count: deleted.size },
        );
        patch.splatMaskUrl = mask.splatMaskUrl;
        patch.splatMaskCount = mask.splatMaskCount;
      } else if (savedMaskUrl) {
        await api.del(`/api/media/${mediaId}/splat-mask`);
        patch.splatMaskUrl = null;
        patch.splatMaskCount = 0;
      }
      const ops = subsetOpsRef.current;
      if (ops.length > 0) {
        const subset = await api.put<{ splatSubsetUrl: string; splatSubsetCount: number }>(
          `/api/media/${mediaId}/splat-subset`,
          { data: bytesToBase64(encodeSubsetOps(ops)), count: ops.length },
        );
        patch.splatSubsetUrl = subset.splatSubsetUrl;
        patch.splatSubsetCount = subset.splatSubsetCount;
      } else if (savedSubsetUrl) {
        await api.del(`/api/media/${mediaId}/splat-subset`);
        patch.splatSubsetUrl = null;
        patch.splatSubsetCount = 0;
      }
      onSaved(patch);
      onClean();
      toast.success(t('splat.editsSaved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('splat.editsSaveFailed'));
    } finally {
      setBusy(false);
    }
  }, [mediaId, buildEdits, deletedRef, subsetOpsRef, savedMaskUrl, savedSubsetUrl, onSaved, onClean, t]);

  // A "reset" that purged the three server write points lived here until lot 14: no caller in
  // the whole front invoked it (dead code, forbidden by the project's CLAUDE.md), and the global
  // write now closes at publication. The need it served, returning to what is saved, is covered
  // by the local revert in `useSplatEditor` (`revertEdits`), which touches nothing on the server.
  return { busy, save };
}
