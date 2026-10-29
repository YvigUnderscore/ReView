// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { FAMILIES, FAMILY_LABEL } from './gridWire';
import { FAMILY_BAR } from '../productionWire';
import { useT } from '../../../i18n';

/**
 * Legend of the status families.
 *
 * It no longer serves to decode the cells, which now write the name of their status: it names the colours of the **progress
 * bar** of a collapsed sequence, the only surface where a family remains a colour and nothing else.
 *
 * The two marks without a family are listed too, and in fact they have no other label: a "to do, not started" cell and an
 * off-schedule cell have no status to name, and look alike enough to be confused without a landmark.
 */
export default function GridLegend() {
  const t = useT();
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-muted-foreground">
      {FAMILIES.map((family) => (
        <li key={family} className="flex items-center gap-1.5">
          <span aria-hidden className={`size-2.5 rounded-full ${FAMILY_BAR[family]}`} />
          {t(FAMILY_LABEL[family])}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-full border border-border bg-transparent" />
        {t('production.grid.idle')}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-px w-3 bg-border" />
        {t('production.grid.unscheduled')}
      </li>
    </ul>
  );
}
