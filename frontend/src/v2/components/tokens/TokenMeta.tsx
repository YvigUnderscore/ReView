// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useT, intlLocale } from '@/v2/i18n';

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short', year: 'numeric' });

/** What a token row says under its name, the same on the personal and the service token lists. */
export interface TokenMetaFields {
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  scopes: readonly string[];
}

/** Dates (created, last used, expiry) and raw scopes of a token. */
export default function TokenMeta({ tok }: { tok: TokenMetaFields }) {
  const t = useT();
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {t('tokens.createdOn', { date: fmt(tok.createdAt) })}
        {tok.lastUsedAt
          ? ` · ${t('tokens.usedOn', { date: fmt(tok.lastUsedAt) })}`
          : ` · ${t('common.neverUsed')}`}
        {tok.expiresAt ? ` · ${t('tokens.expiresOn', { date: fmt(tok.expiresAt) })}` : ''}
      </p>
      <p className="truncate text-2xs text-muted-foreground">
        <code>{tok.scopes.join(' ')}</code>
      </p>
    </>
  );
}
