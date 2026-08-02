// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Columns3 } from 'lucide-react';
import { SegmentedControl } from '../../components/ui/segmented-control';
import type { Model3DCompareState } from './three/useModel3DCompare';

const shortName = (name: string) => (name.length > 22 ? `${name.slice(0, 20)}…` : name);

/**
 * Choix du modèle comparé, dans l'en-tête du chrome : un onglet par modèle de la version, plus
 * « Voir tous » (côte à côte, caméra liée). Monté pour tous les spectateurs quand la version
 * porte plusieurs modèles, hors mode édition.
 */
export default function Model3DCompareBar({ compare }: { compare: Model3DCompareState }) {
  const items = [
    ...compare.models.map((m) => ({
      value: String(m.id),
      label: shortName(m.originalName),
      hint: m.originalName,
      disabled: compare.busy,
    })),
    {
      value: 'all',
      label: 'Voir tous',
      icon: Columns3,
      hint: 'Afficher tous les modèles de la version côte à côte',
      disabled: compare.busy,
    },
  ];

  return (
    <SegmentedControl
      label="Modèle comparé"
      items={items}
      value={compare.mode === 'all' ? 'all' : String(compare.activeId ?? '')}
      onChange={(v) => void (v === 'all' ? compare.viewAll() : compare.switchTo(Number(v)))}
    />
  );
}
