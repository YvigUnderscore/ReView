// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useT } from '../i18n';
import { useBranding } from '../lib/branding';

/** Fallback if the branding is not yet loaded (or if the API is unreachable). */
const UPSTREAM_SOURCE_URL = 'https://github.com/YvigUnderscore/ReView';

/**
 * License notice required by AGPL §13: any person who interacts with ReView over
 * the network must be offered the corresponding source code. It must therefore
 * appear on the **public** surfaces (sign-in, client sharing), not only
 * in administration.
 *
 * The URL comes from the studio setting `studio_source_url`: an instance running with
 * modifications must point to its own sources, not to the upstream repository.
 */
export default function SourceNotice({ className = '' }: { className?: string }) {
  const t = useT();
  const { data: branding } = useBranding();
  return (
    <p className={`text-xs text-muted-foreground ${className}`}>
      {t('license.notice')}{' '}
      <a
        href={branding?.sourceUrl ?? UPSTREAM_SOURCE_URL}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 transition-colors hover:text-foreground"
      >
        {t('license.source')}
      </a>
    </p>
  );
}
