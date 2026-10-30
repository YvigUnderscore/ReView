// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Trash2 } from 'lucide-react';
import { Badge } from '@/v2/components/ui/badge';
import { IconButton } from '@/v2/components/ui/icon-button';
import type { PoiDraftState } from './usePoiDraft';
import { useT } from '@/v2/i18n';

/**
 * Options bar of the "Point of interest" tool: **the same in both viewers**.
 *
 * The "Place at centre" button was REMOVED: arming the tool means being in placement mode, and the next
 * click in the view places the point. The button was the extra step users reported, and on the splat it
 * was even the only route, with nothing on screen saying that the viewer awaited a click.
 *
 * Only what informs remains here: the instruction for the gesture, the number of points placed, and what
 * clears everything. The text and images of each point are set in the composer, where one reads what is
 * about to leave.
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
