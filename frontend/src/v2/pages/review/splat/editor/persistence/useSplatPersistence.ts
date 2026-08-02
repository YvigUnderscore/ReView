// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../../../lib/apiClient';
import type { SplatEdits, SplatEditsPatch } from '../../../reviewTypes';
import type { SplatViewer } from '../../useSplat';
import { applyMaskIndices, fetchMaskIndices } from './applyEdits';
import { bytesToBase64, encodeMask } from './mask';
import { applySubsetOps, encodeSubsetOps, fetchSubsetOps, type SubsetOp } from './subsetOps';
import { useT } from '../../../../../i18n';

/**
 * Persistance des éditions du splat (extrait de `useSplatEditor`, budget de taille) :
 * rechargement des éditions binaires persistées (masque de suppression, transformations de
 * sous-ensembles — Phase 28) et enregistrement/réinitialisation serveur (JSON + binaires).
 * L'état édité (transform, volumes, journal d'ops) reste dans l'éditeur — le hook ne fait
 * que le sérialiser vers l'API et rejouer ce qui est enregistré au chargement.
 */
export function useSplatPersistence(opts: {
  splat: SplatViewer;
  mediaId: number;
  enabled: boolean;
  savedMaskUrl: string | null;
  savedSubsetUrl: string | null;
  /** Masque cumulé (indices masqués) — alimenté ici au chargement, lu à l'enregistrement. */
  deletedRef: RefObject<Set<number>>;
  /** Journal des ops de sous-ensemble — alimenté ici au chargement, lu à l'enregistrement. */
  subsetOpsRef: RefObject<SubsetOp[]>;
  setDeletedCount: (n: number) => void;
  notifyHiddenChanged: (indices: Iterable<number>) => void;
  /** Sérialise l'état courant (transform + volumes + baseFlip) au moment d'enregistrer. */
  buildEdits: () => SplatEdits;
  /** Remet l'état local de l'éditeur à zéro après la purge serveur (reset). */
  afterReset: () => void;
  history: { undoAll: () => void; clear: () => void };
  onSaved: (patch: SplatEditsPatch) => void;
  onClean: () => void;
}) {
  const t = useT();
  const { splat, mediaId, enabled, savedMaskUrl, savedSubsetUrl, deletedRef, subsetOpsRef } = opts;
  const { setDeletedCount, notifyHiddenChanged, buildEdits, afterReset, history, onSaved, onClean } = opts;
  const { ready } = splat;
  const [busy, setBusy] = useState(false);
  const maskInitRef = useRef(false);
  const subsetInitRef = useRef(false);

  // Recharge le masque persisté (une fois) : masque appliqué + compteur initialisé, pour que
  // les suppressions suivantes s'y cumulent à l'enregistrement.
  useEffect(() => {
    if (!enabled || !ready || maskInitRef.current || !savedMaskUrl) return;
    maskInitRef.current = true;
    const handle = splat.getSceneHandle();
    if (!handle) return;
    fetchMaskIndices(savedMaskUrl)
      .then((indices) => {
        deletedRef.current = applyMaskIndices(handle, indices);
        setDeletedCount(deletedRef.current.size);
        notifyHiddenChanged(deletedRef.current);
      })
      .catch(() => toast.error('Masque de suppression illisible'));
  }, [enabled, ready, savedMaskUrl, splat, deletedRef, setDeletedCount, notifyHiddenChanged]);

  // Recharge les transformations de sous-ensembles persistées (une fois) : rejouées sur les
  // données paquées + journal initialisé, pour que les ops suivantes s'y cumulent.
  useEffect(() => {
    if (!enabled || !ready || subsetInitRef.current || !savedSubsetUrl) return;
    subsetInitRef.current = true;
    const handle = splat.getSceneHandle();
    if (!handle) return;
    fetchSubsetOps(savedSubsetUrl)
      .then((ops) => {
        applySubsetOps(handle, ops);
        subsetOpsRef.current = ops;
      })
      .catch(() => toast.error(t('splat.transformUnreadable')));
  }, [enabled, ready, savedSubsetUrl, splat, subsetOpsRef, t]);

  /** Enregistre toutes les éditions : transform + volumes (JSON), masque et ops binaires. */
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
      toast.error(e instanceof Error ? e.message : "Erreur à l'enregistrement des éditions");
    } finally {
      setBusy(false);
    }
  }, [mediaId, buildEdits, deletedRef, subsetOpsRef, savedMaskUrl, savedSubsetUrl, onSaved, onClean, t]);

  /** Réinitialise tout : annule l'historique, purge serveur (JSON + binaires), état local à zéro. */
  const reset = useCallback(async () => {
    setBusy(true);
    try {
      history.undoAll(); // restaure les splats masqués et retire les volumes de la scène
      await api.patch(`/api/media/${mediaId}/splat-edits`, { edits: null });
      if (savedMaskUrl) await api.del(`/api/media/${mediaId}/splat-mask`);
      if (savedSubsetUrl) await api.del(`/api/media/${mediaId}/splat-subset`);
      subsetOpsRef.current = [];
      afterReset();
      history.clear();
      onSaved({
        splatEdits: null,
        splatMaskUrl: null,
        splatMaskCount: 0,
        splatSubsetUrl: null,
        splatSubsetCount: 0,
      });
      onClean();
      toast.success(t('splat.editsReset'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('splat.editsResetFailed'));
    } finally {
      setBusy(false);
    }
  }, [mediaId, history, savedMaskUrl, savedSubsetUrl, subsetOpsRef, afterReset, onSaved, onClean, t]);

  return { busy, save, reset };
}
