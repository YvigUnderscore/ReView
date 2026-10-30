// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertTriangle, CheckCircle2, Eye, UserMinus } from 'lucide-react';
import type { ProductionOverview } from '../../types/production';
import { intlLocale, useT } from '../../i18n';
import { readAttention } from './productionWire';

/**
 * The state of the project in one line.
 *
 * The page stacked six panels, each excellent, but one had to read them all to answer the only question one has on opening
 * it: **is it going well?** Four figures answer it: what is done, what awaits review, what is overdue, and what nobody has
 * taken. The detail is one tab further.
 *
 * The last three are alerts: they only take colour when they matter. A "0 overdue" in red would teach people to ignore colour.
 *
 * These figures used to be the **length of the lists** returned by the server, capped at fifty: a project with three hundred
 * overdue tasks displayed "50", and the tile became all the more wrong as the situation was serious. They are now the totals
 * counted in the database, and the tile says that the list itself is capped.
 */

/** A figure and what it designates. `tone` only lights up above zero. */
function Tile({
  icon: Icon,
  value,
  count,
  label,
  hint,
  tone,
}: {
  icon: typeof Eye;
  value: string;
  /** The numeric value: it is what lights the colour, not the rendered text. */
  count?: number;
  label: string;
  hint?: string;
  tone?: 'warning' | 'destructive';
}) {
  const lit = tone !== undefined && (count ?? 0) > 0;
  const colour = lit
    ? tone === 'destructive'
      ? 'border-destructive/40 bg-destructive/10 text-destructive'
      : 'border-warning/40 bg-warning/10 text-warning'
    : 'border-border bg-card text-foreground';
  return (
    <div
      className={`flex min-w-32 flex-1 items-center gap-2.5 rounded-lg border px-3 py-2 ${colour}`}
      title={hint}
    >
      <Icon size={16} className="shrink-0" />
      <span className="min-w-0">
        <span className="block text-lg font-semibold tabular-nums leading-tight">{value}</span>
        <span className="block truncate text-2xs opacity-80">{label}</span>
        {hint !== undefined && <span className="block truncate text-2xs opacity-60">{hint}</span>}
      </span>
    </div>
  );
}

export default function ProductionSummary({ data }: { data: ProductionOverview }) {
  const t = useT();
  const { done, total } = data.projection;
  const attention = readAttention(data);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const number = (value: number) => value.toLocaleString(intlLocale());
  // The cap is only mentioned when it bites: otherwise the tile would carry one more line for nothing.
  const hint = attention.capped
    ? t('production.summary.capped', { value: number(attention.limit ?? attention.shown) })
    : undefined;

  return (
    <div className="flex flex-wrap gap-2">
      <Tile
        icon={CheckCircle2}
        value={(percent / 100).toLocaleString(intlLocale(), { style: 'percent' })}
        label={t('production.summary.done', { done, total })}
      />
      <Tile
        icon={Eye}
        value={number(attention.waitingReview)}
        count={attention.waitingReview}
        label={t('production.summary.waiting')}
        hint={hint}
        tone="warning"
      />
      <Tile
        icon={AlertTriangle}
        value={number(attention.overdue)}
        count={attention.overdue}
        label={t('production.summary.overdue')}
        hint={hint}
        tone="destructive"
      />
      <Tile
        icon={UserMinus}
        value={number(attention.unassigned)}
        count={attention.unassigned}
        label={t('production.summary.unassigned')}
        hint={hint}
        tone="warning"
      />
    </div>
  );
}
