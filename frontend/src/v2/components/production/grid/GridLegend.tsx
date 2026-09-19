// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { FAMILIES, FAMILY_LABEL } from './gridWire';
import { FAMILY_BAR } from '../productionWire';
import { useT } from '../../../i18n';

/**
 * Légende des familles de statut.
 *
 * C'est la première raison pour laquelle l'écran d'avant était illisible : les cinq
 * couleurs n'étaient nommées que dans un attribut `title`, c'est-à-dire nulle part pour
 * qui ne survole pas exactement la bonne case — et nulle part du tout au clavier.
 *
 * Les deux marques sans famille y figurent aussi : une case « à faire, pas commencé » et
 * une case hors programme se ressemblent assez pour qu'on les confonde sans un repère écrit.
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
