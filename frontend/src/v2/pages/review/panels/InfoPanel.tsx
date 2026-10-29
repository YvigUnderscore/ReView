// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Group, ReadRow } from '../chrome/DockGroup';
import { isLongDockGroup } from '../chrome/dockGroupSize';
import { useT } from '@/v2/i18n';

export interface InfoRow {
  label: string;
  value: ReactNode;
}

/**
 * Info panel of the dock: what is measured during rendering, then what the file declares.
 * Brings together `StatsPanel` (splat), `ModelInfoPanel`/`ModelUsdSection` (3D) and the technical
 * sheet of flat media, with the same layout for the four types.
 *
 * Both groups are **collapsible**, and start collapsed beyond the dock's threshold
 * (`isLongDockGroup`): a USD scene's technical sheet exceeds the panel's height and pushed the
 * measurements of the current frame, which fit in four lines, out of view. Each carries its count,
 * so that a closed group still says what it contains.
 */
export default function InfoPanel({
  live,
  sheet,
  extra,
  action,
}: {
  /** Measurements of the current frame: absent for flat media. */
  live?: InfoRow[];
  sheet: InfoRow[];
  /** Groups that do not fit as label/value pairs: USD scene, texture inspector. */
  extra?: ReactNode;
  /** Bottom-of-panel action ("Recompose from the USD"...). */
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
