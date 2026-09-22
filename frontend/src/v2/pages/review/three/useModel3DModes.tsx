// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type { ChromeState } from '../chrome/chromeState';
import { DEFAULT_MODE, type ModeId, type ReviewMode } from '../chrome/modes';
import type { ReviewTool } from '../chrome/tools';
import { useChromeState } from '../chrome/useChromeState';
import { useSpatialAnnotate } from '../chrome/useSpatialAnnotate';
import SurfaceBrushLayer from '../splat/paint/SurfaceBrushLayer';
import type { SplatPaintState } from '../splat/paint/useSplatPaint';
import type { Annotations } from '../useAnnotations';
import type { Model3DThreeState } from './useModel3DThree';
import {
  canCleanModel3d,
  model3dSwitcherModes,
  model3dToolsFor,
  type Model3DCleanReach,
} from './model3dChrome';

/**
 * Chrome du viewer modèle 3D : la bascule et le rail que ce média offre vraiment, l'outil armé
 * qui en découle, et les deux conséquences directes de cet outil sur la scène — le calque de la
 * brosse de surface et l'atelier caméra. Jumeau de `splat/useSplatView`.
 *
 * Le hook générique (`useChromeState`) accepte les deux listes ; c'est ici qu'on les calcule,
 * une fois, pour que la bascule d'en-tête, les touches numériques, le rail et les lettres
 * d'outils lisent tous la même source. Sans cette unicité, un mode retiré de l'en-tête restait
 * armable au clavier — le bouton mort revenait par la porte de service.
 *
 * `reach` dit où les gizmos du mode « Nettoyer » peuvent écrire : la transformation de version
 * (droit rendu par le serveur) ou l'override de scène USD. Sans ni l'un ni l'autre, le mode
 * n'offre qu'un enregistrement refusé — il disparaît.
 *
 * La garde de vol vient du viewer (`isFlying`) : clic droit maintenu = mode de navigation, où
 * aucune lettre n'arme d'outil (`S`, recul en ZQSD comme en WASD, armait le gizmo Échelle).
 */
export interface Model3DChromeView {
  /** État du chrome (mode, outil, panneau, tiroir) et son patcheur — préférences persistées. */
  state: ChromeState;
  update: (patch: Partial<ChromeState>) => void;
  /** Bascule réellement offerte — la MÊME liste pour l'en-tête et pour les touches numériques. */
  modes: ReviewMode[];
  /** Outils du rail pour le mode courant. */
  tools: ReviewTool[];
  /** Outil armé résolu dans le mode courant (repli : premier outil du mode). */
  activeTool: ReviewTool;
  /** Calque de la brosse de surface — `null` tant qu'aucun de ses deux outils n'est armé. */
  brushLayer: ReactNode;
}

export function useModel3DModes(
  reach: Model3DCleanReach,
  m: Model3DThreeState,
  /** Annotation en cours et brosse de surface : ce que l'outil armé pilote hors du chrome. */
  annotation: { ann: Annotations; paint: SplatPaintState },
): Model3DChromeView {
  const { canEditTransform, hasScenegraph } = reach;
  const { isFlying, setLayoutMode, getDom, ready } = m;
  const canClean = useMemo(
    () => canCleanModel3d({ canEditTransform, hasScenegraph }),
    [canEditTransform, hasScenegraph],
  );
  const modes = useMemo(() => model3dSwitcherModes(canClean), [canClean]);
  const toolsOf = useCallback((mode: ModeId) => model3dToolsFor(mode, canClean), [canClean]);
  const { state, update } = useChromeState('MODEL_3D', { modes, tools: toolsOf, isFlying });

  // Le droit d'écrire la transformation peut tomber sous les pieds de l'utilisateur (version
  // publiée par un superviseur pendant la session) : on ne le laisse pas dans un mode dont le
  // segment vient de disparaître, à manipuler des gizmos qui ne s'enregistreront pas.
  useEffect(() => {
    if (!canClean && state.mode === 'clean') update({ mode: DEFAULT_MODE });
  }, [canClean, state.mode, update]);

  // Bouton « Annoter » du composer ↔ mode « Annoter » du rail : sans ce pont, cliquer « Annoter »
  // sur un modèle n'armait que le crayon 2D et les outils de la scène restaient invisibles.
  useSpatialAnnotate({ state, update, ann: annotation.ann });

  // Mode Mise en scène = atelier caméra : y entrer sort de la caméra du plan, en sortir y rentre.
  // Seule écriture du « dans / hors caméra » — modèle en tête de `viewer/useLayoutMode`.
  useEffect(() => {
    setLayoutMode(state.mode === 'stage');
  }, [state.mode, setLayoutMode]);

  const tools = toolsOf(state.mode);
  return {
    state,
    update,
    modes,
    tools,
    activeTool: tools.find((tool) => tool.id === state.tool) ?? tools[0],
    brushLayer: <SurfaceBrushLayer paint={annotation.paint} ready={ready} getCanvas={getDom} />,
  };
}
