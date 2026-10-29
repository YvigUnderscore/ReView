// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { LOCALES, setLocale, useLocale, useT, type Locale } from '../i18n';
import { Select } from './ui/select';

/**
 * Language picker: lists all languages of the registry, each announced in its
 * own language (a reader does not look for "German", they look for "Deutsch").
 *
 * Regional languages are grouped apart: this is not a detail of storage,
 * it is the way to make them visible instead of drowning them. The coverage label
 * and the machine-translation warning live in `TranslationNotice`, to be displayed
 * next to this picker.
 */
export default function LanguagePicker({
  id,
  className,
  onSelect,
}: {
  id?: string;
  className?: string;
  /**
   * Called after the switch. The component also serves the sign-in screen, where no
   * account exists yet: it is therefore up to the caller to decide whether the choice
   * persists server-side.
   */
  onSelect?: (locale: Locale) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const regional = LOCALES.filter((l) => l.regional);
  const general = LOCALES.filter((l) => !l.regional);

  const choose = (code: Locale) => {
    void setLocale(code);
    onSelect?.(code);
  };

  return (
    <Select
      id={id}
      className={className}
      value={locale}
      aria-label={t('language.select')}
      onChange={(e) => choose(e.target.value as Locale)}
    >
      <optgroup label={t('display.language')}>
        {general.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native}
          </option>
        ))}
      </optgroup>
      <optgroup label={t('language.regional')}>
        {regional.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}
