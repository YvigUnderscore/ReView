// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { coverage, localeInfo, useLocale, useT } from '../i18n';
import { useBranding } from '../lib/branding';

/** Repli si le branding n'est pas encore chargé (ou si l'API est injoignable). */
const UPSTREAM_SOURCE_URL = 'https://github.com/YvigUnderscore/ReView';

/**
 * Avertissement affiché partout où une langue se choisit : les traductions sont produites
 * par une machine, personne ne les a relues. Le dire franchement évite qu'un studio
 * prenne une formulation bancale pour une décision de produit — et ouvre la porte aux
 * corrections, qui sont le seul moyen que ces catalogues s'améliorent.
 *
 * Le lien pointe vers le code source de l'instance (réglage `studio_source_url`), qui est
 * l'endroit où une correction se propose.
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
