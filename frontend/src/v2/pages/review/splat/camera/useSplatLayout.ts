// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useLayoutMode } from '../../viewer/useLayoutMode';
import type { SplatViewer } from '../useSplat';

/**
 * Layout mode of the splat viewer: common core `viewer/useLayoutMode`. The layout camera and the PiP's second
 * scissor pass live in `useSplat` (`restorePipCamera`).
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
