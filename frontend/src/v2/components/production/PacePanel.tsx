// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ProductionOverview } from '../../types/production';
import { intlLocale, useT } from '../../i18n';

/**
 * Rythme et projection (C6).
 *
 * Les livraisons par semaine, l'avancement, et la fin projetée au rythme observé. La
 * projection est toujours accompagnée du rythme qui la produit : une date seule se lirait
 * comme un engagement, alors qu'elle ne vaut que l'hypothèse d'un rythme constant.
 */
export default function PacePanel({ data }: { data: ProductionOverview }) {
  const t = useT();
  const { pace, projection } = data;
  const max = Math.max(1, ...pace.map((p) => p.delivered));
  const pct = projection.total > 0 ? Math.round((projection.done / projection.total) * 100) : 0;
  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">{pct}</span>
          <span className="text-muted-foreground">
            {' '}
            % · {projection.done}/{projection.total}
          </span>
        </span>
        <span className="text-sm text-muted-foreground">
          {t('production.pace.perWeek', { value: projection.perWeek.toFixed(1) })}
        </span>
        <span className="text-sm">
          {projection.projectedEnd ? (
            <>
              <span className="text-muted-foreground">{t('production.pace.projected')} </span>
              <span className="font-medium">
                {new Date(`${projection.projectedEnd}T00:00:00Z`).toLocaleDateString(intlLocale(), {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{t('production.pace.noProjection')}</span>
          )}
        </span>
      </div>

      <div className="flex h-28 items-end gap-1">
        {pace.map((point) => (
          <span
            key={point.weekStart}
            className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
            title={`${shortDate(point.weekStart)} · ${point.delivered}`}
          >
            <span className="text-2xs tabular-nums text-muted-foreground">{point.delivered || ''}</span>
            <span
              className="w-full rounded-t bg-primary/70"
              style={{ height: `${(point.delivered / max) * 100}%`, minHeight: point.delivered > 0 ? 2 : 0 }}
            />
            <span className="w-full truncate text-center text-2xs text-muted-foreground">
              {shortDate(point.weekStart)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
