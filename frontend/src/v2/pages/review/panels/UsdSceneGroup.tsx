// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertTriangle } from 'lucide-react';
import { Group, ReadRow } from '../chrome/DockGroup';
import type { UsdModelInfo } from '../../../types/api';
import { purposeLabel, unitLabel, variantValue } from '../usdDisplay';
import { useT } from '../../../i18n';

/**
 * Section USD de la fiche technique (Phase 45, 45.F) : ce que le convertisseur a réellement
 * ouvert et composé. Trois informations comptent en review :
 *  - la **couche racine** retenue (une archive USD en contient souvent plusieurs) ;
 *  - les **références non résolues** — sans cet avertissement, un modèle arrive gris sans
 *    explication et le réflexe est de blâmer le viewer plutôt que l'archive livrée ;
 *  - les **variantes** en place, point d'entrée de la recomposition.
 */

/**
 * Chemins listés dans le dock. Le serveur en rapporte jusqu'à cinquante ; les premiers
 * suffisent à reconnaître le dossier oublié, et le total reste affiché à côté du titre.
 */
const LISTED = 8;

/** Références non résolues : le seul défaut de la scène que le viewer ne peut pas montrer. */
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

/** Jeux de variantes et valeur courante de chacun — celle que la conversion a réellement posée. */
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
  return (
    <Group title={t('usd.scene')}>
      {usd.missingAssets.length > 0 && <MissingAssets usd={usd} />}
      <ReadRow label={t('usd.rootLayer')} value={usd.rootLayer} stack />
      {usd.defaultPrim && <ReadRow label={t('usd.defaultPrim')} value={usd.defaultPrim} stack />}
      <ReadRow label={t('usd.upAxis')} value={usd.upAxis} />
      <ReadRow label={t('usd.unit')} value={unitLabel(usd.metersPerUnit)} />
      <ReadRow label={t('usd.layers')} value={usd.layerCount} />
      <ReadRow label={t('usd.prims')} value={usd.primCount} />
      <ReadRow label={t('usd.purpose')} value={purposeLabel(usd.selection.purpose)} />
      {/* `hasAnimation` et `frameRange` disent la même chose côté serveur : la plage suffit. */}
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
