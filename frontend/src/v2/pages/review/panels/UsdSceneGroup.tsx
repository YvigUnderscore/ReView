// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertTriangle } from 'lucide-react';
import { Group, ReadRow } from '../chrome/DockGroup';
import { isLongDockGroup } from '../chrome/dockGroupSize';
import type { UsdModelInfo } from '../../../types/api';
import { purposeLabel, unitLabel, variantValue } from '../usdDisplay';
import { useT } from '../../../i18n';

/**
 * USD section of the technical sheet (Phase 45, 45.F): what the converter actually opened and composed.
 * Three pieces of information matter in review:
 *  - the **root layer** retained (a USD archive often contains several);
 *  - the **unresolved references**: without this warning, a model arrives grey with no explanation, and
 *    the reflex is to blame the viewer rather than the delivered archive;
 *  - the **variants** in place, the entry point for recomposition.
 */

/**
 * Paths listed in the dock. The server reports up to fifty; the first ones are enough to recognise the
 * forgotten folder, and the total stays displayed next to the title.
 */
const LISTED = 8;

/**
 * Number of lines the section will actually render: the input to the collapse threshold. Counted rather
 * than guessed: the section ranges from six lines (a bare scene) to eleven (variants, animation, rig,
 * missing references), and it is beyond the dock's threshold that it is worth arriving closed.
 */
function rowCount(usd: UsdModelInfo): number {
  const optional = [
    usd.missingAssets.length > 0,
    Boolean(usd.defaultPrim),
    Boolean(usd.frameRange),
    usd.hasSkeleton,
    usd.variantSets.length > 0,
  ];
  // rootLayer, upAxis, unit, layers, prims, purpose: always present.
  return 6 + optional.filter(Boolean).length;
}

/** Unresolved references: the only defect of the scene that the viewer cannot show. */
function MissingAssets({ usd }: { usd: UsdModelInfo }) {
  const t = useT();
  const listed = usd.missingAssets.slice(0, LISTED);
  return (
    <div className="flex gap-1.5 rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-destructive" />
      <div className="min-w-0">
        <p className="font-medium">
          {t('usd.missingRefs')} <span className="font-mono">{usd.missingAssetsTotal}</span>
        </p>
        <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
          {listed.map((a) => (
            <li key={a} className="truncate" title={a}>
              {a}
            </li>
          ))}
        </ul>
        {usd.missingAssetsTotal > listed.length && (
          <p className="text-muted-foreground">{t('usd.missingRefs.more')}</p>
        )}
        <p className="mt-1 text-muted-foreground">{t('usd.missingRefs.hint')}</p>
      </div>
    </div>
  );
}

/** Variant sets and the current value of each: the one the conversion actually set. */
function VariantSets({ usd }: { usd: UsdModelInfo }) {
  const t = useT();
  const ignored = !usd.selectionApplied && Object.keys(usd.selection.variants).length > 0;
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <p className="text-muted-foreground">{t('usd.variantSets')}</p>
      <ul className="flex flex-col gap-0.5">
        {usd.variantSets.map((v) => (
          <li key={`${v.prim}-${v.name}`} className="flex justify-between gap-3">
            <span className="truncate" title={`${v.prim} · ${v.name}`}>
              {v.name}
            </span>
            <span className="shrink-0 font-mono text-muted-foreground">
              {variantValue(usd.selection.variants, v.prim, v.name, v.selected || '—')}
            </span>
          </li>
        ))}
      </ul>
      {ignored && <p className="text-muted-foreground">{t('usd.selectionIgnored')}</p>}
    </div>
  );
}

export default function UsdSceneGroup({ usd }: { usd: UsdModelInfo }) {
  const t = useT();
  const rows = rowCount(usd);
  return (
    <Group
      title={t('usd.scene')}
      collapsible
      // A long section arrives closed, EXCEPT if it carries unresolved references: that is the only piece of
      // information in the sheet that the viewer cannot show, and collapsing it by default would hide it at
      // the very moment it explains everything on screen.
      defaultCollapsed={isLongDockGroup(rows) && usd.missingAssets.length === 0}
      count={rows}
    >
      {usd.missingAssets.length > 0 && <MissingAssets usd={usd} />}
      <ReadRow label={t('usd.rootLayer')} value={usd.rootLayer} stack />
      {usd.defaultPrim && <ReadRow label={t('usd.defaultPrim')} value={usd.defaultPrim} stack />}
      <ReadRow label={t('usd.upAxis')} value={usd.upAxis} />
      <ReadRow label={t('usd.unit')} value={unitLabel(usd.metersPerUnit)} />
      <ReadRow label={t('usd.layers')} value={usd.layerCount} />
      <ReadRow label={t('usd.prims')} value={usd.primCount} />
      <ReadRow label={t('usd.purpose')} value={purposeLabel(usd.selection.purpose)} />
      {/* `hasAnimation` and `frameRange` say the same thing on the server side: the range is enough. */}
      {usd.frameRange && (
        <ReadRow
          label={t('usd.animation')}
          value={`${usd.frameRange[0]} → ${usd.frameRange[1]}${usd.fps ? ` @ ${usd.fps} fps` : ''}`}
        />
      )}
      {usd.hasSkeleton && <ReadRow label={t('usd.rig')} value={<code>UsdSkel</code>} />}
      {usd.variantSets.length > 0 && <VariantSets usd={usd} />}
    </Group>
  );
}
