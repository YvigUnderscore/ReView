// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ProductionOverview } from '../../types/production';
import { intlLocale, useT, type MessageKey } from '../../i18n';
import { readPace, type PaceUnit, type ProjectionUnavailable } from './productionWire';

/**
 * Rythme et projection (C6).
 *
 * Le panneau annonçait une fin de production au 14 décembre 2028 : l'avancement se comptait
 * en **tâches** et le rythme en **médias publiés**, et la projection divisait l'un par
 * l'autre. Le serveur sépare désormais les deux séries et déclare leur unité ; l'écran
 * n'en nomme aucune qu'il ne connaisse pas, et une projection indisponible **dit sa raison**
 * au lieu d'afficher une date.
 *
 * La projection reste rendue avec le rythme qui la produit : une date seule se lirait comme
 * un engagement, alors qu'elle ne vaut que l'hypothèse d'un rythme constant.
 */

const PER_WEEK_KEY: Record<PaceUnit, MessageKey> = {
  tasks: 'production.pace.perWeekTasks',
  media: 'production.pace.perWeekMedia',
};

const SERIES_KEY: Record<PaceUnit, MessageKey> = {
  tasks: 'production.pace.seriesTasks',
  media: 'production.pace.seriesMedia',
};

const UNAVAILABLE_KEY: Record<ProjectionUnavailable, MessageKey> = {
  'nothing-left': 'production.pace.noProjectionDone',
  'no-velocity': 'production.pace.noProjection',
  'nothing-counted': 'production.pace.noProjectionEmpty',
};

export default function PacePanel({ data }: { data: ProductionOverview }) {
  const t = useT();
  const pace = readPace(data);
  const max = Math.max(1, ...pace.series.map((p) => p.count));
  const number = (value: number, digits = 0) =>
    value.toLocaleString(intlLocale(), { maximumFractionDigits: digits });
  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">{number(pace.percent)}</span>
          <span className="text-muted-foreground">
            {' '}
            % · {t('production.summary.done', { done: pace.done, total: pace.total })}
          </span>
        </span>
        <span className="text-sm text-muted-foreground">
          {t(pace.perWeekUnit ? PER_WEEK_KEY[pace.perWeekUnit] : 'production.pace.perWeek', {
            value: number(pace.perWeek, 1),
          })}
        </span>
        {pace.projectedEnd !== null ? (
          <span className="text-sm">
            <span className="text-muted-foreground">{t('production.pace.projected')} </span>
            <span className="font-medium">
              {new Date(`${pace.projectedEnd}T00:00:00Z`).toLocaleDateString(intlLocale(), {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
            <span className="text-muted-foreground"> · {t('production.pace.basis')}</span>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            {t(UNAVAILABLE_KEY[pace.unavailable ?? 'no-velocity'])}
          </span>
        )}
      </div>

      <div>
        <p className="mb-1 text-2xs text-muted-foreground">
          {t(pace.unit ? SERIES_KEY[pace.unit] : 'production.pace.series')}
        </p>
        <div className="flex h-28 items-end gap-1">
          {pace.series.map((point) => (
            <span
              key={point.weekStart}
              className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
              title={`${shortDate(point.weekStart)} · ${number(point.count)}`}
            >
              <span className="text-2xs tabular-nums text-muted-foreground">
                {point.count > 0 ? number(point.count) : ''}
              </span>
              <span
                className="w-full rounded-t bg-primary/70"
                style={{ height: `${(point.count / max) * 100}%`, minHeight: point.count > 0 ? 2 : 0 }}
              />
              <span className="w-full truncate text-center text-2xs text-muted-foreground">
                {shortDate(point.weekStart)}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
