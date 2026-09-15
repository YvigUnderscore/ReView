// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { useT } from '../../i18n';
import { fmtBytes, type SizeUnit } from './adminShared';
import {
  fieldDisplay,
  fieldUnit,
  type SettingField,
  type SettingsDraft,
  type SettingsUnits,
} from './studioSettings';

/**
 * Les champs de réglages d'une section — **sans bouton**.
 *
 * L'enregistrement appartient à la page (`SaveBar`), pas au groupe de champs : c'est la
 * règle qui a fait disparaître les onze boutons de l'ancienne section fourre-tout. Ce
 * composant ne sait donc que rendre et remonter les saisies.
 *
 * Chaque libellé est relié à son champ par `htmlFor` : le texte grisé du champ est un
 * exemple, jamais un nom accessible.
 */
export default function SettingsFields({
  fields,
  stored,
  draft,
  units,
  onChange,
  onUnit,
}: {
  fields: SettingField[];
  stored: Record<string, string>;
  draft: SettingsDraft;
  units: SettingsUnits;
  onChange: (key: string, value: string) => void;
  onUnit: (field: SettingField, unit: SizeUnit) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      {fields.map((field) => (
        <div key={field.key} className="flex flex-wrap items-center gap-2 text-sm">
          <label className="w-64 text-muted-foreground" htmlFor={`setting-${field.key}`}>
            {t(field.labelKey)}
          </label>
          <Input
            id={`setting-${field.key}`}
            className={field.bytes ? 'w-24 py-1 text-xs' : 'flex-1 py-1 text-xs'}
            placeholder={t(field.hintKey)}
            value={fieldDisplay(field, stored, draft)}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
          {field.bytes && (
            <>
              <Select
                className="py-1 text-xs"
                aria-label={t('settings.sizeUnit')}
                value={fieldUnit(field, stored, units)}
                onChange={(e) => onUnit(field, e.target.value as SizeUnit)}
              >
                {/* Symboles internationaux : « Mo »/« Go » n'existent qu'en français, et
                    la modale « New user » disait déjà « Quota (GB) » deux écrans plus loin. */}
                <option value="MB">MB</option>
                <option value="GB">GB</option>
              </Select>
              <span className="w-24 text-xs text-muted-foreground">
                {stored[field.key] ? `= ${fmtBytes(Number(stored[field.key]))}` : ''}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
