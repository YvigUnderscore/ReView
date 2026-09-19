// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { SkeletonRows } from '../ui/skeleton';
import { readRetakes, type RetakeBucket } from './productionWire';
import type { ProjectStats } from '../../types/api';
import { intlLocale, useT, type MessageKey, type Tr } from '../../i18n';

/**
 * Ce qui tourne en rond : retakes par plan, délai d'approbation, plans qui repassent.
 *
 * Un studio ne perd pas son temps sur les plans difficiles, il le perd sur les plans qui
 * reviennent — et rien dans l'onglet ne le montrait : les retakes n'existaient que comme
 * moyenne noyée au milieu d'autres moyennes. Le panneau les sort et les classe.
 *
 * La lecture de la réponse est déjà écrite et testée (`readRetakes`/`rankRetakes`) : elle
 * retombe sur l'ancienne forme du serveur quand celui d'en face ne rend pas encore les
 * tours de review ni la distribution, plutôt que d'afficher un tableau vide.
 */

const nf = (value: number): string => value.toLocaleString(intlLocale(), { maximumFractionDigits: 1 });

/** Une valeur absente s'écrit comme telle — un zéro serait une affirmation fausse. */
const NONE = '—';

function Tile({ labelKey, value }: { labelKey: MessageKey; value: string }) {
  const t = useT();
  return (
    <div className="rounded-md border border-border bg-background p-2.5">
      <p className="text-2xs uppercase text-muted-foreground">{t(labelKey)}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/** Le libellé d'une tranche : « 3 », « 1–2 », « 5+ ». */
function bucketLabel(bucket: RetakeBucket, t: Tr): string {
  if (bucket.max === null) return t('production.retakes.bucketFrom', { min: bucket.min });
  if (bucket.max === bucket.min) return String(bucket.min);
  return t('production.retakes.bucketRange', { min: bucket.min, max: bucket.max });
}

function BucketRow({ bucket, widest }: { bucket: RetakeBucket; widest: number }) {
  const t = useT();
  return (
    <li className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">
        {bucketLabel(bucket, t)}
      </span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
        <span
          className="block h-full rounded-full bg-info"
          style={{ width: widest > 0 ? `${(bucket.shots / widest) * 100}%` : 0 }}
        />
      </span>
      <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">
        {bucket.shots}
      </span>
    </li>
  );
}

export default function RetakePanel({ projectId }: { projectId: number }) {
  const t = useT();
  const statsQ = useQuery({
    queryKey: qk.projectStats(projectId),
    queryFn: () => api.get<ProjectStats>(`/api/projects/${projectId}/stats`),
    enabled: projectId > 0,
  });

  if (statsQ.error) return <p className="text-sm text-destructive">{statsQ.error.message}</p>;
  if (!statsQ.data) return <SkeletonRows count={4} />;

  const reading = readRetakes(statsQ.data);
  const widest = reading.buckets.reduce((max, bucket) => Math.max(max, bucket.shots), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile labelKey="production.retakes.avgRetakes" value={nf(reading.avgRetakes)} />
        <Tile
          labelKey="production.retakes.avgRounds"
          value={reading.avgReviewRounds === null ? NONE : nf(reading.avgReviewRounds)}
        />
        <Tile
          labelKey="production.retakes.avgDays"
          value={reading.avgReviewDays === null ? NONE : nf(reading.avgReviewDays)}
        />
        <Tile
          labelKey="production.retakes.firstTimeRight"
          value={
            reading.firstTimeRightRate === null
              ? NONE
              : t('production.retakes.percent', { value: reading.firstTimeRightRate })
          }
        />
      </div>

      {reading.buckets.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold">{t('production.retakes.distribution')}</h3>
          <ul className="space-y-1.5">
            {reading.buckets.map((bucket) => (
              <BucketRow key={`${bucket.min}-${bucket.max ?? ''}`} bucket={bucket} widest={widest} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold">{t('production.retakes.worst')}</h3>
        {reading.worst.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('production.retakes.empty')}</p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="px-2 py-1 text-left font-medium">{t('production.retakes.colShot')}</th>
                <th className="px-2 py-1 text-right font-medium">{t('production.retakes.colRetakes')}</th>
                <th className="px-2 py-1 text-right font-medium">{t('production.retakes.colRounds')}</th>
                <th className="px-2 py-1 text-right font-medium">{t('production.retakes.colDays')}</th>
                <th className="px-2 py-1 text-right font-medium">{t('production.retakes.colNotes')}</th>
              </tr>
            </thead>
            <tbody>
              {reading.worst.map((row) => (
                <tr key={row.shotId} className="border-t border-border">
                  <td className="px-2 py-1">
                    <Link
                      to={`/shots/${row.shotId}`}
                      title={row.name}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {row.code}
                    </Link>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{row.retakes}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{row.reviewRounds ?? NONE}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {row.reviewDays === null ? NONE : nf(row.reviewDays)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{row.openNotes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
