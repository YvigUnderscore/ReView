// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useRef } from 'react';
import { confirmClearPresentation } from '../camera/confirmReplaceAnim';
import { useRegisterReviewCommands, type ReviewCommand } from '../../../lib/reviewCommands';
import type { PresentationState } from './presentation/usePresentation';
import { useT } from '../../../i18n';

/**
 * Ctrl+K palette (B3) of the splat block: frame/reset, camera reading, key pose, orbit preset,
 * presentation clearing. `pres` and the framing callbacks are new on every render: the commands
 * recall them via refs synchronised in an effect, so the list stays stable and does not republish
 * the registry on every frame. Extracted from `SplatReview` (line budget).
 */
export function useSplatCommands(opts: {
  pres: PresentationState;
  frameView: () => void;
  homeView: () => void;
  /** Manager: can place keyframes and edit the staging. */
  canPresent: boolean;
  /** A presentation is persisted: only it can be cleared. */
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
