// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Ruler } from 'lucide-react';
import { Group, ReadRow, Row } from '../chrome/DockGroup';
import { IconButton } from '@/v2/components/ui/icon-button';
import { Switch } from '@/v2/components/ui/switch';
import { lengthText } from './measure';
import type { ModelMeasureState } from './useModelMeasure';
import { intlLocale, useT, type Tr } from '@/v2/i18n';

/** Invite line of the measuring tool, depending on the number of points already placed. */
function measureHint(state: ModelMeasureState, t: Tr): string {
  if (state.length) return lengthText(state.length, intlLocale());
  return state.points === 1 ? t('measure.secondPoint') : t('measure.firstPoint');
}

/**
 * Real dimensions and measuring tool, in the Info panel.
 *
 * Loading brings every model back to two world units: without these lines, no length
 * is readable in the product and the A/B compares shapes without ever comparing sizes.
 * The dimensions are those of the **file**'s bounding box, converted with the scene's
 * `metersPerUnit`; the "real size" toggle gives the model back its proportions in the scene,
 * and point-to-point measuring answers "how big is it?".
 */
export default function Model3DMeasureGroup({
  measure,
  realScale,
  onRealScale,
}: {
  measure: ModelMeasureState;
  realScale: boolean;
  onRealScale: (v: boolean) => void;
}) {
  const t = useT();
  const dims = measure.dimensions;
  return (
    <Group
      title={t('measure.title')}
      collapsible
      action={
        <IconButton
          icon={Ruler}
          label={t('measure.tool')}
          bordered
          active={measure.active}
          onClick={measure.toggle}
        />
      }
    >
      {dims && (
        <>
          <ReadRow label={t('measure.width')} value={lengthText(dims[0], intlLocale())} />
          <ReadRow label={t('measure.height')} value={lengthText(dims[1], intlLocale())} />
          <ReadRow label={t('measure.depth')} value={lengthText(dims[2], intlLocale())} />
        </>
      )}
      <Row label={t('viewer.realScale')} hint={t('measure.realScaleHint')}>
        <Switch checked={realScale} onCheckedChange={onRealScale} label={t('viewer.realScale')} />
      </Row>
      {measure.active && <ReadRow label={t('measure.distance')} value={measureHint(measure, t)} />}
    </Group>
  );
}
