// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertTriangle, CheckCircle2, Eye, UserMinus } from 'lucide-react';
import type { ProductionOverview } from '../../types/production';
import { useT } from '../../i18n';

/**
 * L'état du projet en une ligne.
 *
 * La page empilait six panneaux, chacun excellent, mais il fallait les lire tous pour
 * répondre à la seule question qu'on se pose en l'ouvrant : **est-ce que ça va ?** Quatre
 * chiffres y répondent — ce qui est fait, ce qui attend une review, ce qui est en retard,
 * ce que personne n'a pris. Le détail est un onglet plus loin.
 *
 * Les trois derniers sont des alertes : ils se colorent seulement quand ils comptent. Un
 * « 0 en retard » en rouge apprendrait à ignorer la couleur.
 */

/** Un chiffre et ce qu'il désigne. `tone` ne s'allume qu'au-dessus de zéro. */
function Tile({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: typeof Eye;
  value: string;
  label: string;
  tone?: 'warning' | 'destructive';
}) {
  const lit = tone && value !== '0';
  const colour =
    lit === true
      ? tone === 'destructive'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-warning/40 bg-warning/10 text-warning'
      : 'border-border bg-card text-foreground';
  return (
    <div className={`flex min-w-32 flex-1 items-center gap-2.5 rounded-lg border px-3 py-2 ${colour}`}>
      <Icon size={16} className="shrink-0" />
      <span className="min-w-0">
        <span className="block text-lg font-semibold tabular-nums leading-tight">{value}</span>
        <span className="block truncate text-2xs opacity-80">{label}</span>
      </span>
    </div>
  );
}

export default function ProductionSummary({ data }: { data: ProductionOverview }) {
  const t = useT();
  const { done, total } = data.projection;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex flex-wrap gap-2">
      <Tile icon={CheckCircle2} value={`${percent}%`} label={t('production.summary.done', { done, total })} />
      <Tile
        icon={Eye}
        value={String(data.attention.waitingReview.length)}
        label={t('production.summary.waiting')}
        tone="warning"
      />
      <Tile
        icon={AlertTriangle}
        value={String(data.attention.overdue.length)}
        label={t('production.summary.overdue')}
        tone="destructive"
      />
      <Tile
        icon={UserMinus}
        value={String(data.attention.unassigned.length)}
        label={t('production.summary.unassigned')}
        tone="warning"
      />
    </div>
  );
}
