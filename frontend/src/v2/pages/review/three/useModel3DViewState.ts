// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';
import type { Model3DInspectState } from './useModel3DInspect';
import type { Model3DLightingState } from './useModel3DLighting';
import type { Model3DThreeState } from './useModel3DThree';
import type { SectionPlaneState } from './useSectionPlane';

/**
 * Branche l'**état de vue** (mode d'affichage, plan de coupe, éclairage HDRI) sur la vue
 * caméra du viewer : capturé avec le commentaire, rejoué à sa sélection.
 *
 * Un commentaire emportait déjà la caméra, le hotspot, l'animation et la proposition de
 * scène — mais pas ce qui change le plus l'image. « Regarde ce que je vois » renvoyait donc
 * le lecteur à la bonne caméra devant un rendu différent : shaded au lieu de wireframe, coupe
 * refermée, autre HDRI.
 *
 * Les trois hooks sont des objets neufs à chaque rendu : le fournisseur les rappelle par une
 * ref, ce qui garde l'enregistrement stable (une seule fois au montage).
 */
export function useModel3DViewState(params: {
  model3d: Model3DThreeState;
  inspect: Model3DInspectState;
  section: SectionPlaneState;
  lighting: Model3DLightingState;
}): void {
  const { model3d, inspect, section, lighting } = params;
  const { registerViewState } = model3d;
  const latest = useRef({ inspect, section, lighting });
  useEffect(() => {
    latest.current = { inspect, section, lighting };
  });

  useEffect(() => {
    registerViewState({
      capture: () => {
        const { inspect: i, section: s, lighting: l } = latest.current;
        return {
          display: i.mode,
          section: { active: s.active, axis: s.axis, position: s.position, flip: s.flip },
          lighting: l.cfg,
        };
      },
      apply: (state) => {
        const { inspect: i, section: s, lighting: l } = latest.current;
        i.setMode(state.display);
        s.apply(state.section);
        l.setCfg(state.lighting);
      },
    });
    return () => registerViewState(null);
  }, [registerViewState]);
}
