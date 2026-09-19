// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { Clapperboard, Gavel, MessageSquare, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DashboardData } from './homeTypes';
import { useT } from '../../i18n';

/**
 * Compteurs de l'Accueil : mes chiffres d'abord (retakes, reviews qu'on m'a confiées), puis
 * le périmètre (médias en review, commentaires) avec tendance 7 jours.
 *
 * Chaque carte mène à la vue qui la déplie — et c'est la moitié du travail. Deux d'entre
 * elles pointaient l'ancre `#my-tasks`, qui disparaissait avec le bloc « mes tâches » dès
 * qu'on le retirait de son accueil : le clic ne faisait alors rien. Les deux autres menaient
 * à `/reviews` sans filtre, où rien ne correspondait au chiffre affiché — et, pour les
 * commentaires, à une page qui n'en montre aucun.
 *
 * Un compteur qu'on ne peut pas déplier n'est pas vérifiable : c'est à ce moment-là qu'il
 * commence à mentir sans qu'on le sache.
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
      {/* « Ce qu'on attend de moi », et non plus les verdicts attendus de tout le studio :
          la carte est posée parmi mes chiffres, son libellé et son calcul le disent enfin
          tous les deux. Le filtre de la vue est exactement le périmètre du compteur. */}
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
      {/* Le libellé était emprunté au filtre des commentaires d'une review (« All ») et la
          carte menait à /reviews, qui n'en montre aucun. Elle a sa clé et son fil. */}
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
