// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import SettingsRow from '../../components/settings/SettingsRow';
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
 * The settings fields of a section — **without a button**.
 *
 * Saving belongs to the page (`SaveBar`), not to the group of fields: this is the
 * rule that removed the eleven buttons of the old catch-all section. This
 * component therefore only renders and passes inputs back up.
 *
 * The row is that of the three screen families (`SettingsRow`): label on the left linked
 * by `htmlFor`, control on the right. The greyed text of the field is an example, never an
 * accessible name.
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
    <div className="space-y-3">
      {fields.map((field) => (
        <SettingsRow key={field.key} label={t(field.labelKey)} htmlFor={`setting-${field.key}`}>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <Input
              id={`setting-${field.key}`}
              className={field.bytes ? 'w-28 py-1 text-xs' : 'min-w-48 flex-1 py-1 text-xs'}
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
                   {/* International symbols: "Mo"/"Go" exist only in French, and
                       the "New user" modal already said "Quota (GB)" two screens later. */}
                  <option value="MB">MB</option>
                  <option value="GB">GB</option>
                </Select>
                <span className="w-24 text-2xs text-muted-foreground">
                  {stored[field.key] ? `= ${fmtBytes(Number(stored[field.key]))}` : ''}
                </span>
              </>
            )}
          </div>
        </SettingsRow>
      ))}
    </div>
  );
}
