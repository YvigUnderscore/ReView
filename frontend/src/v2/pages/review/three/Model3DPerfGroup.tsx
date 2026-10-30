// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from 'react';
import { Group, ReadRow } from '../chrome/DockGroup';
import type { TextureInfo } from './modelStats';
import {
  estimateTextureBytes,
  megaTriangles,
  megabytes,
  overTriangleBudget,
  TRIANGLE_BUDGET,
  type ModelPerf,
} from './perfStats';
import type { Model3DThreeState } from './useModel3DThree';
import { intlLocale, useT } from '@/v2/i18n';

const fmt = (n: number) => Math.round(n).toLocaleString(intlLocale());

/**
 * Performance counters of the 3D viewer, under the Scene panel: the panel used to receive an empty
 * `perf` object, so no FPS, no render calls and no texture memory, whereas the splat already showed its own.
 * It is the immediate answer to "why is it lagging".
 *
 * The subscription only exists while this group is mounted: panel closed, nothing is measured.
 */
export default function Model3DPerfGroup({
  m,
  textures,
}: {
  m: Model3DThreeState;
  /** Textures reported by the technical sheet: basis of the texture-memory estimate. */
  textures: TextureInfo[] | null;
}) {
  const t = useT();
  const { ready, subscribeStats } = m;
  const [stats, setStats] = useState<ModelPerf | null>(null);
  useEffect(() => (ready ? subscribeStats(setStats) : undefined), [ready, subscribeStats]);
  const textureMb = useMemo(() => megabytes(estimateTextureBytes(textures ?? [])), [textures]);
  const heavy = stats != null && overTriangleBudget(stats.triangles);

  return (
    <Group title={t('panel.performance')}>
      <ReadRow label={t('stats.fps')} value={stats ? fmt(stats.fps) : '—'} />
      <ReadRow label={t('stats.drawCalls')} value={stats ? fmt(stats.calls) : '—'} />
      <ReadRow label={t('model3d.trianglesDrawn')} value={stats ? fmt(stats.triangles) : '—'} />
      <ReadRow label={t('stats.textureMemory')} value={t('stats.mbValue', { value: textureMb })} />
      {heavy && (
        <p className="px-2 pb-1 pt-1.5 text-2xs text-destructive">
          {t('stats.triangleBudget', { value: megaTriangles(TRIANGLE_BUDGET) })}
        </p>
      )}
    </Group>
  );
}
