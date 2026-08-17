// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef } from 'react';
import { confirmClearPresentation } from '../camera/confirmReplaceAnim';
import { useRegisterReviewCommands, type ReviewCommand } from '../../../lib/reviewCommands';
import type { PresentationState } from './presentation/usePresentation';
import { useT } from '../../../i18n';

/**
 * Palette Ctrl+K (B3) du bloc splat : cadrer/reset, lecture caméra, pose de clé, preset orbite,
 * effacement de présentation. `pres` et les rappels de cadrage sont neufs à chaque rendu — les
 * commandes les rappellent via des refs synchronisées en effet, la liste reste stable et ne
 * republie pas le registre à chaque image. Extrait de `SplatReview` (budget lignes).
 */
export function useSplatCommands(opts: {
  pres: PresentationState;
  frameView: () => void;
  homeView: () => void;
  /** Gestionnaire : peut poser des clés et éditer la mise en scène. */
  canPresent: boolean;
  /** Une présentation est persistée — seule elle peut être effacée. */
  hasPresentation: boolean;
}): void {
  const { pres, frameView, homeView, canPresent, hasPresentation } = opts;
  const t = useT();
  const presRef = useRef(pres);
  const viewRef = useRef({ frameView, homeView });
  useEffect(() => {
    presRef.current = pres;
    viewRef.current = { frameView, homeView };
  });
  const hasKeys = pres.anim.keyTimes.length > 0;
  const commands = useMemo<ReviewCommand[]>(
    () => [
      { id: 'fit', label: t('action.fitSpatial'), run: () => viewRef.current.frameView() },
      { id: 'home', label: t('action.resetSpatial'), run: () => viewRef.current.homeView() },
      ...(hasKeys
        ? [
            {
              id: 'play',
              label: t('video.playKey'),
              run: () => {
                if (presRef.current.anim.playing) presRef.current.anim.pause();
                else presRef.current.anim.play();
              },
            },
          ]
        : []),
      ...(canPresent
        ? [
            {
              id: 'key',
              label: t('review.key.set'),
              run: () => presRef.current.anim.insertKeyAtView(),
            },
            {
              id: 'orbit',
              label: t('camera.orbitPreset'),
              run: () => presRef.current.applyOrbitPreset(),
            },
            ...(hasPresentation
              ? [
                  {
                    id: 'clear-pres',
                    label: t('camera.clearPresentation'),
                    run: () => confirmClearPresentation(() => void presRef.current.clear()),
                  },
                ]
              : []),
          ]
        : []),
    ],
    [t, hasKeys, hasPresentation, canPresent],
  );
  useRegisterReviewCommands(commands);
}
