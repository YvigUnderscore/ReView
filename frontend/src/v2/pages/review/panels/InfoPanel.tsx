// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Group, ReadRow } from '../chrome/DockGroup';
import { useT } from '../../../i18n';

export interface InfoRow {
  label: string;
  value: ReactNode;
}

/**
 * Panneau Infos du dock : ce qui se mesure pendant le rendu, puis ce que le fichier déclare.
 * Réunit `StatsPanel` (splat), `ModelInfoPanel`/`ModelUsdSection` (3D) et la fiche technique
 * des médias plats — même mise en page pour les quatre types.
 */
export default function InfoPanel({
  live,
  sheet,
  action,
}: {
  /** Mesures de la frame courante — absentes pour les médias plats. */
  live?: InfoRow[];
  sheet: InfoRow[];
  /** Action de bas de panneau (« Recomposer depuis l'USD »…). */
  action?: ReactNode;
}) {
  const t = useT();
  return (
    <>
      {live && live.length > 0 && (
        <Group title={t('panel.liveRender')}>
          {live.map((r) => (
            <ReadRow key={r.label} label={r.label} value={r.value} />
          ))}
        </Group>
      )}
      <Group title={t('panel.techSheet')}>
        {sheet.map((r) => (
          <ReadRow key={r.label} label={r.label} value={r.value} stack />
        ))}
      </Group>
      {action}
    </>
  );
}
