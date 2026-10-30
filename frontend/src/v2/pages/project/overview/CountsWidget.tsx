// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useT } from '@/v2/i18n';

/**
 * The project's structure counters: sequences, shots, assets. Each card opens the tab it counts,
 * the shortest path to the list.
 */

export interface ProjectCounts {
  sequences: number;
  shots: number;
  assets: number;
}

function StatCard({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-primary"
    >
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </button>
  );
}

export default function CountsWidget({
  counts,
  onGo,
}: {
  counts: ProjectCounts;
  onGo: (tab: string) => void;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatCard label={t('sequences.title')} value={counts.sequences} onClick={() => onGo('sequences')} />
      <StatCard label={t('shots.title')} value={counts.shots} onClick={() => onGo('shots')} />
      {/* "Assets" is production vocabulary: it is not translated into any language
          (cf. `scripts/i18n-glossary.json`), as everywhere else in the application. */}
      <StatCard label="Assets" value={counts.assets} onClick={() => onGo('assets')} />
    </div>
  );
}
