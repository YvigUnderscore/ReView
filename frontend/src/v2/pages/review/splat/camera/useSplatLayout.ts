// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useLayoutMode } from '../../viewer/useLayoutMode';
import type { SplatViewer } from '../useSplat';

/**
 * Mode layout du viewer splat : cœur commun `viewer/useLayoutMode` — la caméra layout et la
 * 2ᵉ passe scissor du PiP vivent dans `useSplat` (`restorePipCamera`).
 */
export function useSplatLayout(splat: SplatViewer) {
  const { subscribeFrame, getDom, captureCamera, restoreCamera, restorePipCamera } = splat;
  return useLayoutMode({
    subscribeFrame,
    getDom,
    captureCamera,
    restoreMain: restoreCamera,
    restoreLayout: restorePipCamera,
  });
}

export type SplatLayoutState = ReturnType<typeof useSplatLayout>;
