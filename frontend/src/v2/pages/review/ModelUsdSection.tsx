import { AlertTriangle } from 'lucide-react';
import type { UsdModelInfo } from '../../types/api';
import { unitLabel, variantValue } from './usdDisplay';

/**
 * Section USD de la fiche technique (Phase 45, 45.F) : ce que le convertisseur a réellement
 * ouvert et composé. Trois informations comptent en review :
 *  - la **couche racine** retenue (une archive USD en contient souvent plusieurs) ;
 *  - les **assets non résolus** — sans cet avertissement, un modèle arrive gris sans explication ;
 *  - les **variantes** en place, point d'entrée de la recomposition (clic droit).
 */

const PURPOSE_LABEL: Record<string, string> = {
  render: 'rendu',
  proxy: 'proxy',
  guide: 'guide',
  default: 'défaut',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

export default function ModelUsdSection({
  usd,
  onRecompose,
}: {
  usd: UsdModelInfo;
  /** Ouvre la recomposition (variantes/purpose) — absent si le média est publié ou en lecture seule. */
  onRecompose?: () => void;
}) {
  return (
    <section className="space-y-1.5 border-t border-border pt-3">
      <p className="font-medium text-foreground">Scène USD</p>

      {usd.missingAssets.length > 0 && (
        <div className="flex gap-1.5 rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {usd.missingAssetsTotal} référence{usd.missingAssetsTotal > 1 ? 's' : ''} non résolue
              {usd.missingAssetsTotal > 1 ? 's' : ''}
            </p>
            <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
              {usd.missingAssets.slice(0, 5).map((a) => (
                <li key={a} className="truncate" title={a}>
                  {a}
                </li>
              ))}
            </ul>
            {usd.missingAssetsTotal > usd.missingAssets.length && (
              <p className="text-muted-foreground">…et d’autres</p>
            )}
          </div>
        </div>
      )}

      <Row label="Couche racine" value={usd.rootLayer} />
      {usd.defaultPrim && <Row label="Prim par défaut" value={usd.defaultPrim} />}
      <Row label="Axe haut" value={usd.upAxis} />
      <Row label="Unité" value={unitLabel(usd.metersPerUnit)} />
      <Row label="Couches" value={String(usd.layerCount)} />
      <Row label="Purpose" value={PURPOSE_LABEL[usd.selection.purpose] ?? usd.selection.purpose} />
      {usd.frameRange && (
        <Row
          label="Animation"
          value={`${usd.frameRange[0]} → ${usd.frameRange[1]}${usd.fps ? ` @ ${usd.fps} fps` : ''}`}
        />
      )}
      {usd.hasSkeleton && <Row label="Rig" value="UsdSkel" />}

      {usd.variantSets.length > 0 && (
        <div className="space-y-0.5 pt-1">
          <p className="font-medium text-foreground">Variantes ({usd.variantSets.length})</p>
          <ul className="space-y-0.5">
            {usd.variantSets.map((v) => (
              <li key={`${v.prim}-${v.name}`} className="flex justify-between gap-3">
                <span className="truncate text-foreground" title={`${v.prim} · ${v.name}`}>
                  {v.name}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {variantValue(usd.selection.variants, v.prim, v.name, v.selected || '—')}
                </span>
              </li>
            ))}
          </ul>
          {!usd.selectionApplied && Object.keys(usd.selection.variants).length > 0 && (
            <p className="text-muted-foreground">
              Sélection non appliquée : le convertisseur utilisé ne gère pas les variantes.
            </p>
          )}
        </div>
      )}

      {/* Action posée au contact des variantes qu'elle modifie, plutôt qu'un bouton de plus
          dans le HUD (règle « UI simple »). */}
      {onRecompose && (
        <button onClick={onRecompose} className="text-left text-primary underline-offset-2 hover:underline">
          Recomposer la scène…
        </button>
      )}
    </section>
  );
}
