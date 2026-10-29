// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { coverage, localeInfo, useLocale, useT } from '../i18n';
import { useBranding } from '../lib/branding';

/** Fallback if the branding is not yet loaded (or if the API is unreachable). */
const UPSTREAM_SOURCE_URL = 'https://github.com/YvigUnderscore/ReView';

/**
 * Warning displayed wherever a language is chosen: translations are produced
 * by a machine, and nobody has proofread them. Saying so frankly prevents a studio
 * from taking an awkward wording for a product decision, and opens the door to
 * corrections, which are the only way these catalogs improve.
 *
 * The link points to the instance's source code (`studio_source_url` setting), which is
 * where a correction is proposed.
 */
export default function TranslationNotice({ className = '' }: { className?: string }) {
  const t = useT();
  const locale = useLocale();
  const { data: branding } = useBranding();
  const info = localeInfo(locale);
  const stats = coverage(locale);

  return (
    <div className={`space-y-1.5 rounded-md border border-border bg-secondary/40 p-3 text-xs ${className}`}>
      <p className="font-medium text-foreground">{t('language.notice.title')}</p>
      <p className="text-muted-foreground">{t('language.notice.body')}</p>
      <p className="text-muted-foreground">{t('language.notice.contribute')}</p>
      {info.machineTranslated && stats && (
        <p className="text-muted-foreground">
          {stats.translated === stats.total
            ? t('language.coverage.complete')
            : t('language.coverage', {
                count: stats.translated,
                translated: stats.translated,
                total: stats.total,
              })}
          {stats.translated < stats.total && ` — ${t('language.fallbackNotice')}`}
        </p>
      )}
      <a
        href={branding?.sourceUrl ?? UPSTREAM_SOURCE_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-block underline underline-offset-2 transition-colors hover:text-foreground"
      >
        {t('language.notice.link')}
      </a>
    </div>
  );
}
