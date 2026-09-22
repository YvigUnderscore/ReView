// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { FAMILIES, FAMILY_LABEL } from './gridWire';
import { FAMILY_BAR } from '../productionWire';
import { useT } from '../../../i18n';

/**
 * Légende des familles de statut.
 *
 * Elle ne sert plus à décoder les cases, qui écrivent désormais le nom de leur statut :
 * elle nomme les couleurs de la **barre d'avancement** d'une sequence repliée, seule
 * surface où une famille reste une couleur et rien d'autre.
 *
 * Les deux marques sans famille y figurent aussi, et c'est même leur seul écrit : une case
 * « à faire, pas commencé » et une case hors programme n'ont pas de statut à nommer, et se
 * ressemblent assez pour qu'on les confonde sans un repère.
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
