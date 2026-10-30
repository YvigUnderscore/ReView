// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { Clapperboard, Gavel, MessageSquare, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DashboardData } from './homeTypes';
import { useT } from '../../i18n';

/**
 * Home counters: my own figures first (retakes, reviews entrusted to me), then the scope (media
 * in review, comments), with a 7-day trend.
 *
 * Each card leads to the view that unfolds it, and that is half the work. Two of them pointed to
 * the `#my-tasks` anchor, which vanished with the "my tasks" block as soon as it was removed from
 * the home page: the click then did nothing. The other two led to `/reviews` without a filter,
 * where nothing matched the displayed figure, and, for comments, to a page that shows none.
 *
 * A counter that cannot be unfolded cannot be verified: that is precisely when it starts lying
 * without anyone noticing.
 */

function StatCard({
  icon: Icon,
  cls,
  value,
  label,
  trend,
  to,
  alert,
}: {
  icon: LucideIcon;
  cls: string;
  value: number;
  label: string;
  trend?: string;
  to: string;
  alert?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/60 ${
        alert ? 'border-destructive/40' : 'border-border'
      }`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${cls}`}>
        <Icon size={19} />
      </span>
      <span className="min-w-0">
        <span className="flex items-baseline gap-1.5">
          <span className="text-xl font-semibold leading-tight">{value}</span>
          {trend && <span className="truncate text-xs text-muted-foreground">{trend}</span>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </Link>
  );
}

export default function StatsRow({ stats }: { stats: DashboardData['stats'] }) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        icon={RotateCcw}
        cls="bg-destructive/10 text-destructive"
        value={stats.myRetakes}
        label={t('home.stat.myRetakes')}
        to="/my-tasks?scope=blocked"
        alert={stats.myRetakes > 0}
      />
      {/* "What is expected of me", instead of the verdicts expected from the whole studio:
          the card now sits among my own figures, and its label and its computation finally say
          the same thing. The view's filter is exactly the counter's scope. */}
      <StatCard
        icon={Gavel}
        cls="bg-warning/10 text-warning"
        value={stats.awaitingMyReview}
        label={t('home.stat.awaitingMyReview')}
        to="/reviews?assigned=me&decision=none"
      />
      <StatCard
        icon={Clapperboard}
        cls="bg-accent2/10 text-accent2"
        value={stats.mediaInReview}
        label={t('home.mediaInReview')}
        trend={
          stats.mediaInReview7d > 0 ? t('home.stat.last7d', { count: stats.mediaInReview7d }) : undefined
        }
        to="/reviews?status=published&decision=none"
      />
      {/* The label was borrowed from a review's comment filter ("All"), and the card led to
          /reviews, which shows none. It now has its own key and thread. */}
      <StatCard
        icon={MessageSquare}
        cls="bg-info/10 text-info"
        value={stats.comments}
        label={t('home.stat.comments')}
        trend={stats.comments7d > 0 ? t('home.stat.last7d', { count: stats.comments7d }) : undefined}
        to="/comments"
      />
    </div>
  );
}
