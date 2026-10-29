// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Undo2 } from 'lucide-react';
import PoiNotice from '../poi/PoiNotice';
import { useT } from '../../../i18n';

/**
 * Status banner of the 3D viewer, above the scene: what the viewer expects from you, or the
 * output of what it shows you. Only one at a time, in this order of priority.
 *
 *  1. **Placing a point of interest**: the tool is armed, the viewer waits for a click. The same
 *     banner serves the splat (`poi/PoiNotice`): the gesture's instruction is not said twice.
 *  2. **Scene proposed by a comment** (46.T): we navigate in someone else's scene; the
 *     button (or Escape) releases it.
 */
export default function Model3DNotice({
  placingPoi,
  poiCount,
  commentScene,
  onReleaseScene,
}: {
  placingPoi: boolean;
  poiCount: number;
  commentScene: boolean;
  onReleaseScene: () => void;
}) {
  const t = useT();
  if (placingPoi) return <PoiNotice count={poiCount} />;
  if (!commentScene) return null;
  return (
    <button
      onClick={onReleaseScene}
      title={t('review.resetScene')}
      className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-lg ring-2 ring-primary/30 hover:opacity-90"
    >
      <Undo2 size={12} /> {t('review.commentScene')}
      <kbd className="rounded bg-primary-foreground/20 px-1 text-2xs">{t('common.escKey')}</kbd>
    </button>
  );
}
