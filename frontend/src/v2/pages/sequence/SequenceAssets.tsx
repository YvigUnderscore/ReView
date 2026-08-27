// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import EntityThumb from '../../components/entity/EntityThumb';
import type { SequenceDetailData } from '../project/projectTypes';
import { useT } from '../../i18n';

/** Assets rattachés à la séquence — décor, véhicules, éléments partagés par ses plans. */
export default function SequenceAssets({ assets }: { assets: SequenceDetailData['assets'] }) {
  const t = useT();
  if (assets.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
        {t('sequences.assets', { count: assets.length })}
      </h2>
      <div className="flex flex-wrap gap-2">
        {assets.map((a) => (
          <Link
            key={a.id}
            to={`/assets/${a.id}`}
            className="group flex items-center gap-2 rounded-md border border-border p-1.5 pr-3 transition-colors hover:border-primary"
          >
            <span className="flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
              <EntityThumb url={a.thumbnailUrl} name={a.name} variant="mini" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm group-hover:text-primary">{a.name}</span>
              <span className="block truncate text-2xs text-muted-foreground">{a.typeLabel ?? a.type}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
