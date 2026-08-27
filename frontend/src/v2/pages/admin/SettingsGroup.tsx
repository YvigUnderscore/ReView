// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { useT } from '../../i18n';
import {
  SETTING_GROUP_LABEL,
  type SettingField,
  type SettingGroup as GroupKey,
  type SizeUnit,
  bytesToUnit,
  fmtBytes,
  parseSizeToBytes,
} from './adminShared';

/**
 * Une famille de réglages du studio : un titre, ses champs, **un** bouton d'enregistrement.
 *
 * La section empilait onze réglages sans rapport dans une seule boîte sans titre, chacun
 * avec son propre bouton : on ne savait ni où l'on était, ni ce qu'on validait. Le
 * regroupement rend l'intention lisible, et l'enregistrement unique ne pousse que ce qui a
 * réellement changé — ce qui évite d'écraser au passage un réglage modifié entre-temps par
 * quelqu'un d'autre.
 */
export default function SettingsGroup({
  group,
  fields,
  stored,
  onSave,
}: {
  group: GroupKey;
  fields: SettingField[];
  stored: Record<string, string>;
  onSave: (values: { key: string; value: string }[]) => Promise<void>;
}) {
  const t = useT();
  // Saisies en cours, par clé. Une clé absente = champ jamais touché, donc non envoyé.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, SizeUnit>>({});
  const [busy, setBusy] = useState(false);

  const unitOf = (field: SettingField) =>
    units[field.key] ?? bytesToUnit(Number(stored[field.key]) || 0).unit;

  const valueOf = (field: SettingField) => {
    if (draft[field.key] !== undefined) return draft[field.key];
    if (!field.bytes) return stored[field.key] ?? '';
    const raw = Number(stored[field.key]) || 0;
    return raw ? bytesToUnit(raw).value : '';
  };

  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    const payload: { key: string; value: string }[] = [];
    for (const field of fields) {
      const typed = draft[field.key];
      if (typed === undefined) continue;
      if (!field.bytes) {
        payload.push({ key: field.key, value: typed });
        continue;
      }
      const bytes = parseSizeToBytes(typed, unitOf(field));
      if (bytes == null) {
        toast.error(t('settings.invalidNumber'));
        return;
      }
      payload.push({ key: field.key, value: String(bytes) });
    }
    if (payload.length === 0) return;
    setBusy(true);
    try {
      await onSave(payload);
      setDraft({});
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <h3 className="text-sm font-semibold">{t(SETTING_GROUP_LABEL[group])}</h3>
      {fields.map((field) => (
        <div key={field.key} className="flex flex-wrap items-center gap-2 text-sm">
          <label className="w-64 text-muted-foreground" htmlFor={`setting-${field.key}`}>
            {t(field.labelKey)}
          </label>
          <Input
            id={`setting-${field.key}`}
            className={field.bytes ? 'w-24 py-1 text-xs' : 'flex-1 py-1 text-xs'}
            placeholder={t(field.hintKey)}
            value={valueOf(field)}
            onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
          />
          {field.bytes && (
            <>
              <Select
                className="py-1 text-xs"
                aria-label={t('settings.sizeUnit')}
                value={unitOf(field)}
                onChange={(e) => {
                  const unit = e.target.value as SizeUnit;
                  setUnits((u) => ({ ...u, [field.key]: unit }));
                  // Changer d'unité est une modification : sans cela le bouton restait
                  // inerte alors que la valeur envoyée aurait changé.
                  setDraft((d) => ({ ...d, [field.key]: valueOf(field) }));
                }}
              >
                <option value="Mo">Mo</option>
                <option value="Go">Go</option>
              </Select>
              <span className="w-24 text-xs text-muted-foreground">
                {stored[field.key] ? `= ${fmtBytes(Number(stored[field.key]))}` : ''}
              </span>
            </>
          )}
        </div>
      ))}
      <div className="flex justify-end pt-1">
        <Button variant="outline" size="sm" disabled={!dirty || busy} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      </div>
    </section>
  );
}
