// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { LOCALES, setLocale, useLocale, useT, type Locale } from '../i18n';
import { Select } from './ui/select';

/**
 * Sélecteur de langue — liste toutes les langues du registre, chacune annoncée dans sa
 * propre langue (un lecteur ne cherche pas « German », il cherche « Deutsch »).
 *
 * Les langues régionales sont regroupées à part : ce n'est pas un détail de rangement,
 * c'est la manière de les rendre visibles au lieu de les noyer. Le libellé de couverture
 * et l'avertissement de traduction automatique vivent dans `TranslationNotice`, à afficher
 * à côté de ce sélecteur.
 */
export default function LanguagePicker({ id, className }: { id?: string; className?: string }) {
  const t = useT();
  const locale = useLocale();
  const regional = LOCALES.filter((l) => l.regional);
  const general = LOCALES.filter((l) => !l.regional);

  return (
    <Select
      id={id}
      className={className}
      value={locale}
      aria-label={t('language.select')}
      onChange={(e) => void setLocale(e.target.value as Locale)}
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
