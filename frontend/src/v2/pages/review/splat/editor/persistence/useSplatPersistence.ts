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
  /**
   * Volumes binaires DÉJÀ enregistrés au média, relevés ici au chargement (Phase 50, lot 14).
   *
   * C'est ce qui permet de distinguer ce que l'auteur a ajouté de ce qu'il a simplement trouvé :
   * une proposition jointe à un commentaire ne doit porter que son geste à lui, sinon chaque
   * note rejouerait sur le nuage du lecteur des ops déjà appliquées chez lui.
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
        basesRef.current.mask = deletedRef.current.size;
        setDeletedCount(deletedRef.current.size);
        notifyHiddenChanged(deletedRef.current);
      })
      .catch(() => toast.error(t('splat.maskUnreadable')));
  }, [enabled, ready, savedMaskUrl, splat, deletedRef, basesRef, setDeletedCount, notifyHiddenChanged, t]);

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
        basesRef.current.subset = ops.length;
      })
      .catch(() => toast.error(t('splat.transformUnreadable')));
  }, [enabled, ready, savedSubsetUrl, splat, subsetOpsRef, basesRef, t]);

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
      toast.error(e instanceof Error ? e.message : t('splat.editsSaveFailed'));
    } finally {
      setBusy(false);
    }
  }, [mediaId, buildEdits, deletedRef, subsetOpsRef, savedMaskUrl, savedSubsetUrl, onSaved, onClean, t]);

  // Une « réinitialisation » purgeant les trois points d'écriture serveur a vécu ici jusqu'au
  // lot 14 : aucun appelant dans tout le front ne l'invoquait (code mort, interdit par le
  // CLAUDE.md du projet), et l'écriture globale se referme désormais à la publication. Le
  // besoin qu'elle servait — revenir à ce qui est enregistré — est tenu par la reprise locale
  // de `useSplatEditor` (`revertEdits`), qui ne touche à rien côté serveur.
  return { busy, save };
}
