// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getLocale, setLocale, useT, type Locale } from '../lib/i18n';

const LOCALE_LABEL: Record<Locale, string> = { fr: 'FR', en: 'EN' };

/** Bascule de langue (socle i18n) : boutons FR/EN, persistée en localStorage. */
export default function LocaleSwitch() {
  const t = useT();
  const active = getLocale();
  return (
    <div className="flex items-center gap-1" title={t('auth.language')}>
      {(Object.keys(LOCALE_LABEL) as Locale[]).map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
            l === active
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          }`}
        >
          {LOCALE_LABEL[l]}
        </button>
      ))}
    </div>
  );
}
