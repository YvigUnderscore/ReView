// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef } from 'react';
import { confirmClearPresentation } from '../camera/confirmReplaceAnim';
import { useRegisterReviewCommands, type ReviewCommand } from '../../../lib/reviewCommands';
import type { Model3DThreeState } from './useModel3DThree';
import type { useModel3DCamera } from './useModel3DCamera';
import type { ModelMeasureState } from './useModelMeasure';
import { useT } from '../../../i18n';

type CameraState = ReturnType<typeof useModel3DCamera>;

/**
 * Palette Ctrl+K (B3) du bloc modèle 3D : cadrer/reset, lecture caméra, pose de clé, preset
 * orbite, effacement de présentation, **taille réelle et mesure**. `cam`/`model3d` sont des
 * objets neufs à chaque rendu : les commandes les rappellent via des refs synchronisées en
 * effet, la liste reste stable.
 *
 * Règle « UI simple » : l'échelle réelle et la mesure entrent par la palette (et par le
 * panneau Infos où se lisent leurs résultats), pas par deux boutons de plus sur la scène.
 */
export function useModel3DCommands(
  cam: CameraState,
  model3d: Model3DThreeState,
  canManage: boolean,
  hasPresentation: boolean,
  measure: ModelMeasureState,
): void {
  const t = useT();
  const camRef = useRef(cam);
  const m3dRef = useRef(model3d);
  const measureRef = useRef(measure);
  useEffect(() => {
    camRef.current = cam;
    m3dRef.current = model3d;
    measureRef.current = measure;
  });
  const hasKeys = cam.anim.keyTimes.length > 0;
  const commands = useMemo<ReviewCommand[]>(
    () => [
      { id: 'fit', label: t('action.fitSpatial'), run: () => m3dRef.current.frameView() },
      { id: 'home', label: t('action.resetSpatial'), run: () => m3dRef.current.homeView() },
      {
        id: 'real-scale',
        label: t('viewer.realScale'),
        run: () => m3dRef.current.setRealScale(!m3dRef.current.realScale),
      },
      { id: 'measure', label: t('measure.tool'), run: () => measureRef.current.toggle() },
      ...(hasKeys
        ? [
            {
              id: 'play',
              label: t('video.playKey'),
              run: () => {
                if (camRef.current.anim.playing) camRef.current.anim.pause();
                else camRef.current.anim.play();
              },
            },
          ]
        : []),
      ...(canManage
        ? [
            {
              id: 'key',
              label: t('review.key.set'),
              run: () => camRef.current.anim.insertKeyAtView(),
            },
            {
              id: 'orbit',
              label: t('camera.orbitPreset'),
              run: () => camRef.current.applyOrbitPreset(),
            },
            ...(hasPresentation
              ? [
                  {
                    id: 'clear-pres',
                    label: t('camera.clearPresentation'),
                    run: () => confirmClearPresentation(() => void camRef.current.clear?.()),
                  },
                ]
              : []),
          ]
        : []),
    ],
    [t, hasKeys, hasPresentation, canManage],
  );
  useRegisterReviewCommands(commands);
}
