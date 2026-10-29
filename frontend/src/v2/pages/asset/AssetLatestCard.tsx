// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { Copy, Film, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { reviewPath } from '../../lib/slug';
import type { AssetLatest } from '../../types/api';
import { intlLocale, useT } from '../../i18n';

/**
 * "Latest version" card of an asset (Phase 45).
 *
 * It answers the only question anyone asks when opening an asset: where does it stand? The
 * answer is not the most recent version but the one at the most advanced step of the
 * pipe — a modelling fix published after lookdev does not roll the asset back.
 *
 * The "permanent" link copied here points to `/{assets|shots}/:id/latest`, which always
 * redirects to the current state: pasted into a production note, it simply stays valid
 * months later without anyone having to update it.
 *
 * The card has also served shots since phase 45 (C3): it then received a shot identifier under the name `assetId` and copied `/assets/<id>/latest`, the address
 * of an unrelated entity that the recipient opened without suspecting anything.
 */
export default function AssetLatestCard({
  assetId,
  entity = 'asset',
  latest,
}: {
  assetId: number;
  entity?: 'asset' | 'shot';
  latest: AssetLatest;
}) {
  const t = useT();
  const media = latest.media;

  const copyPermalink = async () => {
    const url = `${window.location.origin}/${entity === 'shot' ? 'shots' : 'assets'}/${assetId}/latest`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('asset.latest.linkCopied'));
    } catch {
      toast.error(t('common.error.generic'));
    }
  };

  return (
    <section className="mb-4 flex items-center gap-4 rounded-lg border border-primary/40 bg-card p-3">
      <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background">
        {media?.thumbnailUrl ? (
          <img src={media.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Film size={20} className="text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-2xs font-semibold section-label text-primary">{t('asset.latest.title')}</div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium">{latest.versionName}</span>
          {latest.departmentName && (
            <span className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
              <Layers size={11} /> {latest.departmentName}
            </span>
          )}
          {latest.taskName && <span className="text-xs text-muted-foreground">{latest.taskName}</span>}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {new Date(latest.createdAt).toLocaleDateString(intlLocale())}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={copyPermalink}
          title={t('asset.latest.copyLink')}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
        >
          <Copy size={14} />
        </button>
        {media && (
          <Link
            to={reviewPath(media)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            {t('asset.latest.open')}
          </Link>
        )}
      </div>
    </section>
  );
}
