// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeAnim } from '../camera/channels/model';
import type { ChromeState } from '../chrome/chromeState';
import { toolsFor, type ReviewTool } from '../chrome/tools';
import { useChromeState } from '../chrome/useChromeState';
import type { MediaResp } from '../reviewTypes';
import type { EditorTool } from './editor/useSplatEditor';
import type { PresentationState } from './presentation/usePresentation';
import { DEFAULT_CULLING_OFF } from './scene/cullingDefault';
import type { SplatViewer } from './useSplat';

/** Tracé de sélection armé dans l'overlay ancré à la vue (null : aucun tracé en cours). */
export type SplatSelectTool = 'rect' | 'lasso' | 'brush';

export interface SplatViewState {
  /** État du chrome (mode, outil, panneau, tiroir) et son patcheur — préférences persistées. */
  state: ChromeState;
  update: (patch: Partial<ChromeState>) => void;
  /** Interrupteur de culling du panneau — réglage de session, non persisté. */
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
  const { state, update } = useChromeState('SPLAT');
  // Culling Spark neutralisé par défaut : rien ne disparaît en zoom fort (réglage de session).
  const [cullingOff, setCullingOffState] = useState(DEFAULT_CULLING_OFF);
  const onCullingOff = useCallback(
    (off: boolean) => {
      setCullingOffState(off);
      splat.setCullingOff(off);
    },
    [splat],
  );

  // Mode Mise en scène = atelier caméra : entrer dans le mode active le layout (PiP +
  // caméra-objet), en sortir le désactive. L'interrupteur du panneau Caméra reste en override.
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
    culling: { off: cullingOff, onOff: onCullingOff },
    activeTool,
    selectTool,
    animDirty,
  };
}
