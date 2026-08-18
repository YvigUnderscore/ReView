// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { Clapperboard, Gavel, MessageSquare, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DashboardData } from './homeTypes';
import { useT } from '../../i18n';

/**
 * Compteurs de l'Accueil (refonte G) : mes chiffres d'abord (retakes, verdicts attendus),
 * puis le périmètre (médias en review, commentaires) avec tendance 7 jours. Chaque carte
 * est cliquable : vers /reviews, ou vers la section « Mes tâches » de la page (ancre).
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
  const body = (
    <>
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
    </>
  );
  const frame = `flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/60 ${
    alert ? 'border-destructive/40' : 'border-border'
  }`;
  // Ancre interne (#my-tasks) : simple <a>, le router n'a rien à y faire.
  if (to.startsWith('#'))
    return (
      <a href={to} className={frame}>
        {body}
      </a>
    );
  return (
    <Link to={to} className={frame}>
      {body}
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
        to="#my-tasks"
        alert={stats.myRetakes > 0}
      />
      <StatCard
        icon={Gavel}
        cls="bg-warning/10 text-warning"
        value={stats.pendingReview}
        label={t('home.stat.pendingReview')}
        to="#my-tasks"
      />
      <StatCard
        icon={Clapperboard}
        cls="bg-accent2/10 text-accent2"
        value={stats.publishedMedia}
        label={t('home.mediaInReview')}
        trend={
          stats.publishedMedia7d > 0 ? t('home.stat.last7d', { count: stats.publishedMedia7d }) : undefined
        }
        to="/reviews"
      />
      <StatCard
        icon={MessageSquare}
        cls="bg-info/10 text-info"
        value={stats.comments}
        label={t('comments.filter.all')}
        trend={stats.comments7d > 0 ? t('home.stat.last7d', { count: stats.comments7d }) : undefined}
        to="/reviews"
      />
    </div>
  );
}
