// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Columns3 } from 'lucide-react';
import { SegmentedControl } from '../../../../components/ui/segmented-control';
import type { SplatCompareState } from './useSplatCompare';
import { useT } from '../../../../i18n';

const shortName = (name: string) => (name.length > 22 ? `${name.slice(0, 20)}…` : name);

/**
 * Choice of the compared splat, in the chrome's header: one tab per splat of the version, plus "See all"
 * (side by side). Replaces `CompareBar`, which floated over the scene; the raw scale of the clouds has joined
 * the Display panel, with the other render settings.
 */
export default function CompareControl({ compare }: { compare: SplatCompareState }) {
  const t = useT();
  const items = [
    ...compare.splats.map((m) => ({
      value: String(m.id),
      label: shortName(m.originalName),
      hint: m.originalName,
      disabled: compare.busy,
    })),
    {
      value: 'all',
      label: t('review.compare.showAll'),
      icon: Columns3,
      hint: t('compare.allSplats'),
      disabled: compare.busy,
    },
  ];

  return (
    <SegmentedControl
      label={t('review.compare.splat')}
      items={items}
      value={compare.mode === 'all' ? 'all' : String(compare.activeId ?? '')}
      onChange={(v) => void (v === 'all' ? compare.viewAll() : compare.switchTo(Number(v)))}
    />
  );
}
