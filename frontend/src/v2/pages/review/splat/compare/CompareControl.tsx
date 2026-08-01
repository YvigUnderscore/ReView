import { Columns3 } from 'lucide-react';
import { SegmentedControl } from '../../../../components/ui/segmented-control';
import type { SplatCompareState } from './useSplatCompare';

const shortName = (name: string) => (name.length > 22 ? `${name.slice(0, 20)}…` : name);

/**
 * Choix du splat comparé, dans l'en-tête du chrome : un onglet par splat de la version, plus
 * « Voir tous » (côte à côte). Remplace `CompareBar`, qui flottait sur la scène ; l'échelle
 * brute des nuages a rejoint le panneau Affichage, avec les autres réglages de rendu.
 */
export default function CompareControl({ compare }: { compare: SplatCompareState }) {
  const items = [
    ...compare.splats.map((m) => ({
      value: String(m.id),
      label: shortName(m.originalName),
      hint: m.originalName,
      disabled: compare.busy,
    })),
    {
      value: 'all',
      label: 'Voir tous',
      icon: Columns3,
      hint: 'Afficher tous les splats de la version côte à côte',
      disabled: compare.busy,
    },
  ];

  return (
    <SegmentedControl
      label="Splat comparé"
      items={items}
      value={compare.mode === 'all' ? 'all' : String(compare.activeId ?? '')}
      onChange={(v) => void (v === 'all' ? compare.viewAll() : compare.switchTo(Number(v)))}
    />
  );
}
