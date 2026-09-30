// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { reviewPath } from '../../lib/slug';
import type { AssetTreeVersion } from '../../types/api';
import { useT, intlLocale } from '../../i18n';

/**
 * Carte d'une version : sa vignette, sa décision de review, ses médias secondaires.
 *
 * Extraite de `AssetTaskCards` — elle décrit une version, pas une tâche, et le fichier des
 * tâches avait dépassé son budget de lignes en accueillant la disposition en colonnes.
 */
export default function VersionCard({ version, sgUrl }: { version: AssetTreeVersion; sgUrl: string | null }) {
  const t = useT();
  const media = version.media[0];

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      {media ? (
        <Link to={reviewPath(media)} className="block h-28 overflow-hidden bg-secondary/30">
          {media.thumbnailUrl ? (
            <img src={media.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {media.kind}
            </span>
          )}
        </Link>
      ) : (
        <div className="flex h-28 items-center justify-center bg-secondary/20 text-xs text-muted-foreground">
          {t('asset.card.noMedia')}
        </div>
      )}
      <div className="space-y-1.5 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium">{version.name}</span>
          {sgUrl && (
            <a
              href={sgUrl}
              target="_blank"
              rel="noreferrer"
              title={t('shotgrid.openIn.version')}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <ExternalLink size={12} />
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {version.reviewStatus && (
            <span
              className="rounded px-1.5 py-0.5 text-2xs"
              style={{
                backgroundColor: `${version.reviewStatus.color}22`,
                color: version.reviewStatus.color,
              }}
            >
              {version.reviewStatus.name}
            </span>
          )}
          {!version.published && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-2xs text-muted-foreground">
              {t('media.draft')}
            </span>
          )}
          <span className="text-2xs text-muted-foreground">
            {new Date(version.createdAt).toLocaleDateString(intlLocale())}
          </span>
        </div>
        {version.media.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {version.media.slice(1).map((m) => (
              <Link
                key={m.id}
                to={reviewPath(m)}
                title={m.originalName}
                className="flex h-7 w-10 items-center justify-center overflow-hidden rounded border border-border hover:border-primary"
              >
                {m.thumbnailUrl ? (
                  <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-2xs text-muted-foreground">{m.kind}</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
