// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeAnim } from '../camera/channels/model';
import type { ChromeState } from '../chrome/chromeState';
import type { ReviewMode } from '../chrome/modes';
import { toolsFor, type ReviewTool } from '../chrome/tools';
import { useChromeState } from '../chrome/useChromeState';
import type { MediaResp } from '../reviewTypes';
import type { EditorTool } from './editor/useSplatEditor';
import type { PresentationState } from './presentation/usePresentation';
import { readCullingOff, writeCullingOff } from './scene/cullingDefault';
import { splatSwitcherModes } from './splatChrome';
import type { SplatViewer } from './useSplat';

/** Tracé de sélection armé dans l'overlay ancré à la vue (null : aucun tracé en cours). */
export type SplatSelectTool = 'rect' | 'lasso' | 'brush';

/**
 * Bascule du splat — liste fixe, calculée une fois. Elle ne porte que des **clés** de
 * traduction, jamais de libellé traduit : rien n'y fige la langue au chargement. La rendre
 * stable évite de réinscrire le gestionnaire clavier du chrome à chaque rendu.
 */
const SWITCHER_MODES = splatSwitcherModes();

export interface SplatViewState {
  /** État du chrome (mode, outil, panneau, tiroir) et son patcheur — préférences persistées. */
  state: ChromeState;
  update: (patch: Partial<ChromeState>) => void;
  /**
   * Bascule réellement offerte — la MÊME liste pour l'en-tête et pour les touches numériques.
   * Sans cette unicité, un segment retiré de l'en-tête resterait armable au clavier.
   */
  modes: ReviewMode[];
  /** Interrupteur de culling du panneau — préférence mémorisée par utilisateur. */
  culling: { off: boolean; onOff: (off: boolean) => void };
  /** Outil armé résolu dans le mode courant (repli : premier outil du mode). */
  activeTool: ReviewTool;
  /** Tracé de sélection à armer dans l'overlay, déduit de l'outil de l'éditeur. */
  selectTool: SplatSelectTool | null;
  /** L'animation caméra diffère de la présentation persistée (bouton « Enregistrer »). */
  animDirty: boolean;
}

/**
 * État de vue du bloc splat : chrome (mode/outil/panneau), culling, correspondance outil armé →
 * tracé de sélection, et l'écart entre l'animation courante et la présentation persistée.
 * Extrait de `SplatReview` (budget lignes) — rien ici ne touche à la scène Three, sauf
 * l'interrupteur de culling, qui la pilote par la poignée du viewer.
 */
export function useSplatView({
  splat,
  data,
  pres,
  editorTool,
}: {
  splat: SplatViewer;
  data: MediaResp;
  pres: PresentationState;
  /** Outil courant de l'éditeur splat (l'overlay de tracé en dépend). */
  editorTool: EditorTool;
}): SplatViewState {
  // Garde de vol : clic droit maintenu = mode de navigation, le clavier appartient au vol et
  // aucune lettre d'outil n'arme de gizmo (`S` armait l'Échelle en reculant).
  //
  // `modes` est la bascule que le splat offre VRAIMENT : « Mise en scène » et « Nettoyer » l'ont
  // quittée (cf. `splatChrome`), il n'y reste qu'« Explorer » — la bascule s'efface donc. Les
  // touches numériques lisent la même liste : un segment absent de l'en-tête ne s'arme pas au
  // clavier. Les LETTRES d'outils, elles, continuent de mener aux deux modes, `toolsFor` restant
  // la seule autorité du rail comme du clavier.
  const { state, update } = useChromeState('SPLAT', {
    modes: SWITCHER_MODES,
    isFlying: splat.isFlying,
  });
  // Culling Spark actif par défaut, sauf préférence contraire — mémorisée par utilisateur.
  const [cullingOff, setCullingOffState] = useState(readCullingOff);
  const onCullingOff = useCallback(
    (off: boolean) => {
      setCullingOffState(off);
      writeCullingOff(off);
      splat.setCullingOff(off);
    },
    [splat],
  );

  // Mode Mise en scène = atelier caméra : entrer dans le mode sort de la caméra du plan (PiP +
  // caméra-objet), en sortir y rentre. **Seule écriture** du mode layout côté splat depuis la
  // Phase 50 : l'interrupteur du panneau Caméra pilote `state.mode`, comme en 3D, au lieu
  // d'appeler `setLayoutMode` en parallèle (deux sources de vérité qui pouvaient diverger).
  const { setLayoutMode } = pres.layout;
  useEffect(() => {
    setLayoutMode(state.mode === 'stage');
  }, [state.mode, setLayoutMode]);

  // « Non enregistré » = l'animation diffère de la présentation persistée — et plus « une
  // animation existe » (qui restait sale pour toujours, même juste après une publication).
  const savedAnimJson = useMemo(
    () => JSON.stringify(normalizeAnim(data.splatPresentation?.cameraAnim)),
    [data.splatPresentation],
  );
  const animDirty = pres.anim.hasAnimation && JSON.stringify(pres.anim.anim) !== savedAnimJson;

  const selectTool: SplatSelectTool | null =
    editorTool === 'select-rect'
      ? 'rect'
      : editorTool === 'select-lasso'
        ? 'lasso'
        : editorTool === 'brush'
          ? 'brush'
          : null;

  const activeTool =
    toolsFor(state.mode, 'SPLAT').find((tool) => tool.id === state.tool) ?? toolsFor(state.mode, 'SPLAT')[0];

  return {
    state,
    update,
    modes: SWITCHER_MODES,
    culling: { off: cullingOff, onOff: onCullingOff },
    activeTool,
    selectTool,
    animDirty,
  };
}
