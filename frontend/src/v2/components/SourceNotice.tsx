// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useT } from '../i18n';
import { useBranding } from '../lib/branding';

/** Repli si le branding n'est pas encore chargé (ou si l'API est injoignable). */
const UPSTREAM_SOURCE_URL = 'https://github.com/YvigUnderscore/ReView';

/**
 * Mention de licence exigée par l'AGPL §13 : toute personne qui interagit avec ReView à
 * travers le réseau doit se voir offrir le code source correspondant. Elle doit donc
 * apparaître sur les surfaces **publiques** (connexion, partage client), pas seulement
 * dans l'administration.
 *
 * L'URL vient du réglage studio `studio_source_url` : une instance qui tourne avec des
 * modifications doit pointer ses propres sources, pas le dépôt amont.
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
