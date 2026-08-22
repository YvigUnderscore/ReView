// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Ruler } from 'lucide-react';
import { Group, ReadRow, Row } from '../chrome/DockGroup';
import { IconButton } from '../../../components/ui/icon-button';
import { Switch } from '../../../components/ui/switch';
import { lengthText } from './measure';
import type { ModelMeasureState } from './useModelMeasure';
import { intlLocale, useT, type Tr } from '../../../i18n';

/** Ligne d'invite de l'outil de mesure selon le nombre de points déjà posés. */
function measureHint(state: ModelMeasureState, t: Tr): string {
  if (state.length) return lengthText(state.length, intlLocale());
  return state.points === 1 ? t('measure.secondPoint') : t('measure.firstPoint');
}

/**
 * Dimensions réelles et outil de mesure, dans le panneau Infos.
 *
 * Le chargement ramène tout modèle à deux unités monde : sans ces lignes, aucune longueur
 * n'est lisible dans le produit et l'A/B compare des formes sans jamais comparer des tailles.
 * Les dimensions sont celles de la boîte englobante **du fichier**, converties avec le
 * `metersPerUnit` de la scène ; la bascule « taille réelle » rend au modèle ses proportions
 * dans la scène, et la mesure point-à-point répond au « ça fait combien ? ».
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
