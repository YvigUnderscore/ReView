// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Trash2 } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { IconButton } from '../../../components/ui/icon-button';
import type { PoiDraftState } from './usePoiDraft';
import { useT } from '../../../i18n';

/**
 * Barre d'options de l'outil « Point d'intérêt » — **la même dans les deux viewers**.
 *
 * Le bouton « Poser au centre » a été RETIRÉ : armer l'outil, c'est être en placement, et le
 * clic suivant dans la vue pose le point. Le bouton était l'étape de trop que l'utilisateur
 * signalait, et sur le splat il était même le seul chemin — sans rien à l'écran pour dire que
 * le viewer attendait un clic.
 *
 * Il ne reste ici que ce qui renseigne : la consigne du geste, le nombre de points posés, et de
 * quoi tout effacer. Le texte et les images de chaque point se règlent dans le composeur, où on
 * lit ce qui va partir.
 */
export default function PoiOptions({ poi }: { poi: PoiDraftState }) {
  const t = useT();
  const count = poi.points.length;
  return (
    <>
      <span className="rv-optbar__hint">{t('poi.optionsHint')}</span>
      <span className="rv-rule" />
      <Badge variant={count ? 'default' : 'muted'}>{t('poi.count', { count })}</Badge>
      <IconButton
        icon={Trash2}
        label={t('poi.clearAll')}
        bordered
        onClick={poi.clear}
        disabled={count === 0}
      />
    </>
  );
}
