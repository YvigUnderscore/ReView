// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect } from 'react';
import type { MediaResp } from '../reviewTypes';
import type { SplatEditProposal } from './splatEditPart';
import type { SplatViewer } from './useSplat';
import { applyMaskIndices, applySavedVolumes, fetchMaskIndices } from './editor/persistence/applyEdits';
import { hideSplats, restoreSplats } from './editor/operations/deleteSplats';
import {
  applySubsetOps,
  applySubsetOpsReversible,
  fetchSubsetOps,
  revertSubsetOps,
} from './editor/persistence/subsetOps';
import { disposeVolume, type VolumeRuntime } from './editor/volumes/cropVolume';

/**
 * Rejeu des éditions du nuage **en lecture** : transformation et flip d'orientation, puis volumes
 * de crop (sans filaire), masque de suppression et transformations de sous-ensembles.
 *
 * Deux sources, jamais mélangées sur la transformation :
 *  - les éditions du **média**, quand aucun commentaire n'est lu — l'éditeur les gère lui-même
 *    quand il est monté, d'où le retrait ;
 *  - la **proposition** d'un commentaire (lot 14), qui prend la main dès qu'elle existe, éditeur
 *    monté ou non. C'est tout l'objet du lot : un gestionnaire est la seule personne capable de
 *    produire une proposition, et jusqu'ici c'était la seule à qui on refusait de la montrer.
 *    L'éditeur, lui, se suspend (`useEditorSuspend`) et reprend sa scène intacte à la sortie.
 *
 * Les binaires de la proposition (masque, ops de sous-ensemble) sont **défaits à la sortie** : le
 * masque restaure les seuls splats qu'il avait masqués en plus, et les ops rejouées sont annulées
 * par leur instantané. Sans cela, relâcher le commentaire laisserait le nuage du média troué et
 * déplacé jusqu'au prochain rechargement.
 */
export function useSavedSplatEdits(
  splat: SplatViewer,
  data: MediaResp,
  showEdit: boolean,
  proposal?: SplatEditProposal | null,
): void {
  const { applyTransform, setBaseFlip, ready, getSceneHandle } = splat;
  // La lecture pilote le nuage quand il n'y a pas d'éditeur, ou quand une proposition est lue.
  const reading = !showEdit || proposal != null;
  const saved = proposal ?? data.splatEdits;

  const savedTransform = saved?.transform ?? null;
  const savedFlip = saved?.baseFlip ?? true;
  useEffect(() => {
    if (reading && ready) {
      applyTransform(savedTransform);
      setBaseFlip(savedFlip);
    }
  }, [reading, ready, applyTransform, savedTransform, setBaseFlip, savedFlip]);

  // Les éditions comptent pour tous les spectateurs : elles sont rejouées telles quelles.
  const savedVolumes = saved?.volumes ?? null;
  // Binaires : ceux de la proposition quand elle est lue, ceux du média sinon. Éditeur monté, les
  // binaires DU MÉDIA sont déjà chargés par la persistance — les rejouer ici masquerait deux fois
  // et surtout rejouerait deux fois les ops de sous-ensemble, qui ne sont pas idempotentes.
  const maskUrl = proposal ? proposal.maskUrl : showEdit ? null : data.splatMaskUrl;
  const subsetUrl = proposal ? proposal.subsetUrl : showEdit ? null : data.splatSubsetUrl;
  const undoBinaries = proposal != null;
  useEffect(() => {
    if (!reading || !ready) return;
    const handle = getSceneHandle();
    if (!handle) return;
    let disposed = false;
    let created: VolumeRuntime[] = [];
    let hidden: ReturnType<typeof hideSplats> = null;
    let replayed: ReturnType<typeof applySubsetOpsReversible> = [];
    void (async () => {
      if (savedVolumes?.length) {
        created = await applySavedVolumes(handle, savedVolumes, false);
        if (disposed) created.forEach(disposeVolume);
      }
      if (maskUrl) {
        const indices = await fetchMaskIndices(maskUrl).catch(() => []);
        if (!disposed && indices.length) {
          // `hideSplats` ignore ce qui est déjà masqué et rend les opacités d'origine du reste :
          // c'est exactement ce qu'il faut rendre à la sortie, sans toucher au masque du média.
          if (undoBinaries) hidden = hideSplats(handle, indices);
          else applyMaskIndices(handle, indices);
        }
      }
      if (subsetUrl) {
        const ops = await fetchSubsetOps(subsetUrl).catch(() => []);
        if (!disposed && ops.length) {
          if (undoBinaries) replayed = applySubsetOpsReversible(handle, ops);
          else applySubsetOps(handle, ops);
        }
      }
    })();
    return () => {
      disposed = true;
      created.forEach(disposeVolume);
      if (hidden) restoreSplats(handle, hidden);
      if (replayed.length) revertSubsetOps(handle, replayed);
    };
  }, [reading, ready, getSceneHandle, savedVolumes, maskUrl, subsetUrl, undoBinaries]);
}
