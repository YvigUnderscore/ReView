// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Group, ReadRow } from '../chrome/DockGroup';
import { isLongDockGroup } from '../chrome/dockGroupSize';
import { useT } from '../../../i18n';

export interface InfoRow {
  label: string;
  value: ReactNode;
}

/**
 * Panneau Infos du dock : ce qui se mesure pendant le rendu, puis ce que le fichier déclare.
 * Réunit `StatsPanel` (splat), `ModelInfoPanel`/`ModelUsdSection` (3D) et la fiche technique
 * des médias plats — même mise en page pour les quatre types.
 *
 * Les deux groupes sont **repliables**, et arrivent repliés au-delà du seuil du dock
 * (`isLongDockGroup`) : une fiche technique de scène USD dépasse la hauteur du panneau et
 * poussait hors champ les mesures de la frame courante, qui tiennent en quatre lignes. Chacun
 * porte son décompte, pour qu'un groupe fermé dise quand même ce qu'il contient.
 */
export default function InfoPanel({
  live,
  sheet,
  extra,
  action,
}: {
  /** Mesures de la frame courante — absentes pour les médias plats. */
  live?: InfoRow[];
  sheet: InfoRow[];
  /** Groupes qui ne tiennent pas en couples libellé/valeur : scène USD, inspecteur de textures. */
  extra?: ReactNode;
  /** Action de bas de panneau (« Recomposer depuis l'USD »…). */
  action?: ReactNode;
}) {
  const t = useT();
  return (
    <>
      {live && live.length > 0 && (
        <Group
          title={t('panel.liveRender')}
          collapsible
          defaultCollapsed={isLongDockGroup(live.length)}
          count={live.length}
        >
          {live.map((r) => (
            <ReadRow key={r.label} label={r.label} value={r.value} />
          ))}
        </Group>
      )}
      <Group
        title={t('panel.techSheet')}
        collapsible
        defaultCollapsed={isLongDockGroup(sheet.length)}
        count={sheet.length}
      >
        {sheet.map((r) => (
          <ReadRow key={r.label} label={r.label} value={r.value} stack />
        ))}
      </Group>
      {extra}
      {action}
    </>
  );
}
