// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AlertTriangle, CheckCircle2, Eye, UserMinus } from 'lucide-react';
import type { ProductionOverview } from '../../types/production';
import { intlLocale, useT } from '../../i18n';
import { readAttention } from './productionWire';

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
 *
 * Ces chiffres étaient la **longueur des listes** rendues par le serveur, plafonnées à
 * cinquante : un projet avec trois cents tâches en retard affichait « 50 », et la tuile
 * devenait d'autant plus fausse que la situation était grave. Ce sont maintenant les
 * totaux comptés en base, et la tuile dit que la liste, elle, est plafonnée.
 */

/** Un chiffre et ce qu'il désigne. `tone` ne s'allume qu'au-dessus de zéro. */
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
  /** Ce que `value` vaut en nombre : c'est lui qui allume la couleur, pas le texte rendu. */
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
  // Le plafond ne se dit que lorsqu'il mord : sinon la tuile porterait une ligne de plus
  // pour ne rien apprendre.
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
