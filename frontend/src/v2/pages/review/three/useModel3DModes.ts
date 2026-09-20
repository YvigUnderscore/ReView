// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo } from 'react';
import { DEFAULT_MODE, type ModeId } from '../chrome/modes';
import { useChromeState } from '../chrome/useChromeState';
import {
  canCleanModel3d,
  model3dSwitcherModes,
  model3dToolsFor,
  type Model3DCleanReach,
} from './model3dChrome';

/**
 * État du chrome pour le viewer modèle 3D : la bascule et le rail que ce média offre vraiment.
 *
 * Le hook générique (`useChromeState`) accepte les deux listes ; c'est ici qu'on les calcule,
 * une fois, pour que la bascule d'en-tête, les touches numériques, le rail et les lettres
 * d'outils lisent tous la même source. Sans cette unicité, un mode retiré de l'en-tête restait
 * armable au clavier — le bouton mort revenait par la porte de service.
 *
 * `reach` dit où les gizmos du mode « Nettoyer » peuvent écrire : la transformation de version
 * (droit rendu par le serveur) ou l'override de scène USD. Sans ni l'un ni l'autre, le mode
 * n'offre qu'un enregistrement refusé — il disparaît.
 */
export function useModel3DModes(reach: Model3DCleanReach) {
  const { canEditTransform, hasScenegraph } = reach;
  const canClean = useMemo(
    () => canCleanModel3d({ canEditTransform, hasScenegraph }),
    [canEditTransform, hasScenegraph],
  );
  const modes = useMemo(() => model3dSwitcherModes(canClean), [canClean]);
  const toolsOf = useCallback((mode: ModeId) => model3dToolsFor(mode, canClean), [canClean]);
  const { state, update } = useChromeState('MODEL_3D', { modes, tools: toolsOf });

  // Le droit d'écrire la transformation peut tomber sous les pieds de l'utilisateur (version
  // publiée par un superviseur pendant la session) : on ne le laisse pas dans un mode dont le
  // segment vient de disparaître, à manipuler des gizmos qui ne s'enregistreront pas.
  useEffect(() => {
    if (!canClean && state.mode === 'clean') update({ mode: DEFAULT_MODE });
  }, [canClean, state.mode, update]);

  return { state, update, modes, tools: toolsOf(state.mode) };
}
