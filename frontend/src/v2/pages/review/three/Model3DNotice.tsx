// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Undo2 } from 'lucide-react';
import PoiNotice from '../poi/PoiNotice';
import { useT } from '../../../i18n';

/**
 * Bandeau d'état du viewer 3D, au-dessus de la scène : ce que le viewer attend de vous, ou la
 * sortie de ce qu'il vous montre. Un seul à la fois, dans cet ordre de priorité.
 *
 *  1. **Placement d'un point d'intérêt** — l'outil est armé, le viewer attend un clic. Le même
 *     bandeau sert au splat (`poi/PoiNotice`) : la consigne du geste ne se dit pas deux fois.
 *  2. **Scène proposée par un commentaire** (46.T) — on navigue dans la scène d'un autre ; le
 *     bouton (ou Échap) la relâche.
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
