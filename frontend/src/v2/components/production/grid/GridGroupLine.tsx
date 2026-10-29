// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChevronRight } from 'lucide-react';
import { FAMILY_BAR } from '../productionWire';
import { HEAD_W, lineWidth } from './gridLayout';
import { FAMILIES, familyTally, type SequenceGroup } from './gridWire';
import { useT } from '@/v2/i18n';

/**
 * The row of a sequence: its name, and the progress of all its shots.
 *
 * This is where the sequence level survives the disappearance of the progress matrix: it becomes the collapsed state of the
 * grid. Collapsing a sequence renders exactly the summary of before; expanding it shows which shot waits for what, which the
 * summary did not say.
 *
 * The colours of the bar are those the legend names, just above the table: no information is reserved for hover.
 */
export default function GridGroupLine({
  group,
  columns,
  colWidth,
  collapsed,
  onToggle,
}: {
  group: SequenceGroup;
  /** Number of visible columns: the row must span the width of the table. */
  columns: number;
  /** Width of a department column, set by the table. */
  colWidth: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const tally = familyTally(group.rows);
  return (
    <div
      role="row"
      className="flex h-full items-center border-b border-border bg-secondary/40"
      style={{ width: lineWidth(columns, colWidth) }}
    >
      <div
        role="rowheader"
        className="sticky left-0 z-10 flex h-full min-w-0 items-center gap-1 bg-secondary px-1.5"
        style={{ width: HEAD_W }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold transition-colors hover:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <ChevronRight size={13} aria-hidden className={collapsed ? 'shrink-0' : 'shrink-0 rotate-90'} />
          {group.episodeCode && (
            <span className="shrink-0 text-2xs font-normal text-muted-foreground">{group.episodeCode}</span>
          )}
          <span className="truncate">{group.sequenceCode ?? t('tree.outsideSequence')}</span>
        </button>
        <span className="ml-auto shrink-0 text-2xs tabular-nums text-muted-foreground">
          {t('production.grid.shotCount', { count: group.rows.length })}
        </span>
      </div>
      <div
        role="gridcell"
        aria-colspan={columns}
        className="flex h-full min-w-0 items-center gap-2 border-l border-border/40 px-2"
      >
        {tally.total > 0 && (
          <>
            <span aria-hidden className="flex h-2 w-40 shrink-0 overflow-hidden rounded-full bg-secondary">
              {FAMILIES.map((family) =>
                tally.counts[family] > 0 ? (
                  <span
                    key={family}
                    className={FAMILY_BAR[family]}
                    style={{ width: `${(tally.counts[family] / tally.total) * 100}%` }}
                  />
                ) : null,
              )}
            </span>
            <span className="text-2xs tabular-nums text-muted-foreground">
              {t('production.grid.tally', { done: tally.done, total: tally.total })}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
