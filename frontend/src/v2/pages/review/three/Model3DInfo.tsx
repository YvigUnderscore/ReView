// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Layers } from 'lucide-react';
import { Button } from '@/v2/components/ui/button';
import InfoPanel, { type InfoRow } from '../panels/InfoPanel';
import TexturesGroup from '../panels/TexturesGroup';
import UsdSceneGroup from '../panels/UsdSceneGroup';
import type { MediaResp } from '../reviewTypes';
import type { ModelSource } from '@/v2/types/api';
import Model3DMeasureGroup from './Model3DMeasureGroup';
import type { Model3DInspectState } from './useModel3DInspect';
import type { Model3DThreeState } from './useModel3DThree';
import type { ModelMeasureState } from './useModelMeasure';
import { intlLocale, useT, type MessageKey, type Tr } from '@/v2/i18n';

/**
 * Info panel of the 3D viewer: what is measured during rendering, the technical sheet of the
 * file (including its conversion provenance), the USD scene and the texture inspector.
 * Separate from `Model3DPanels`, which only routes the six tabs: the sheet is the only
 * panel to cross three sources (Three statistics, `modelSource`, USD description).
 */

const fmt = (n: number) => Math.round(n).toLocaleString(intlLocale());

/** Label of the converter that produced the displayed GLB; `assimp` is shown as is. */
const CONVERTER_KEY: Record<string, MessageKey> = {
  copy: 'model3d.converter.copy',
  gltf: 'model3d.converter.gltf',
  blender: 'model3d.converter.blender',
  usd: 'model3d.converter.usd',
};

/**
 * Converter used, followed by the "native" badge when the full USD chain was used:
 * that is the difference between faithful materials and bare geometry, and it explains
 * half of the "why doesn't it look like my render" questions.
 */
function converterValue(source: ModelSource, t: Tr): ReactNode {
  const key = CONVERTER_KEY[source.converter];
  return (
    <span className="flex items-center gap-1.5">
      {key ? t(key) : source.converter}
      {source.native && (
        <span
          title={t('model3d.native.hint')}
          className="rounded bg-secondary px-1.5 py-0.5 text-2xs text-secondary-foreground"
        >
          {t('model3d.native')}
        </span>
      )}
    </span>
  );
}

export default function Model3DInfo({
  data,
  inspect,
  measure,
  m,
  onRecompose,
}: {
  data: MediaResp;
  inspect: Model3DInspectState;
  /** Real dimensions and measuring tool (39.G). */
  measure: ModelMeasureState;
  m: Model3DThreeState;
  /**
   * Shortcut to the USD recomposition, which has lived in the Scene panel since lot 13. The button
   * no longer opens a modal: it leads to where the variant selection is set, while looking at
   * the scene. Absent without rights or without a USD source.
   */
  onRecompose?: () => void;
}) {
  const t = useT();
  const s = inspect.stats;
  const source = data.modelSource;

  const live: InfoRow[] = s
    ? [
        { label: t('model3d.meshes'), value: fmt(s.meshes) },
        { label: t('model3d.triangles'), value: fmt(s.triangles) },
        { label: t('model3d.vertices'), value: fmt(s.vertices) },
        { label: t('viewer.materials'), value: fmt(s.materials.length) },
      ]
    : [{ label: t('stats.measuring'), value: '—' }];

  const sheet: InfoRow[] = [{ label: t('review.file'), value: data.media.originalName }];
  if (source) {
    sheet.push(
      { label: t('model3d.sourceFormat'), value: source.sourceFormat },
      { label: t('model3d.converter'), value: converterValue(source, t) },
    );
  }
  sheet.push(
    { label: t('info.uvSets'), value: s?.uvSets.length ? s.uvSets.join(', ') : t('review.none') },
    {
      label: t('model3d.extensions'),
      value: inspect.extensions.length ? inspect.extensions.join(', ') : t('common.noneFem'),
    },
  );

  return (
    <InfoPanel
      live={live}
      sheet={sheet}
      extra={
        <>
          <Model3DMeasureGroup measure={measure} realScale={m.realScale} onRealScale={m.setRealScale} />
          {source?.usd && <UsdSceneGroup usd={source.usd} />}
          {/* A model without textures is common (sculpt, blocking): no empty group. */}
          {s && s.textures.length > 0 && <TexturesGroup textures={s.textures} />}
        </>
      }
      action={
        onRecompose && (
          <Button size="sm" variant="outline" title={t('usd.recomposeInScene')} onClick={onRecompose}>
            <Layers size={13} />
            {t('usd.recomposeFrom')}
          </Button>
        )
      }
    />
  );
}
