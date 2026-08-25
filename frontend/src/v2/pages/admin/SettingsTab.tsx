// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { SkeletonRows } from '../../components/ui/skeleton';
import TranslationNotice from '../../components/TranslationNotice';
import TaskPolicyField from './TaskPolicyField';
import { BASE_LOCALE, LOCALES, isLocale, type Locale } from '../../i18n';
import { useT } from '../../i18n';
import {
  SETTINGS_FIELDS,
  type SettingField,
  type SizeUnit,
  bytesToUnit,
  fmtBytes,
  parseSizeToBytes,
} from './adminShared';

/** Champ taille (Mo/Go) : saisie convertie en octets à l'enregistrement (parse `.` et `,`). */
function SizeField({
  field,
  stored,
  onSave,
}: {
  field: SettingField;
  stored: string;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const t = useT();
  const init = bytesToUnit(Number(stored) || 0);
  const [value, setValue] = useState(stored ? init.value : '');
  const [unit, setUnit] = useState<SizeUnit>(init.unit);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const bytes = parseSizeToBytes(value, unit);
    if (bytes == null) return toast.error(t('settings.invalidNumber'));
    await onSave(field.key, String(bytes));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="w-64 text-muted-foreground">{t(field.labelKey)}</label>
      <Input
        className="w-24 py-1 text-xs"
        placeholder={t(field.hintKey)}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Select className="py-1 text-xs" value={unit} onChange={(e) => setUnit(e.target.value as SizeUnit)}>
        <option value="Mo">Mo</option>
        <option value="Go">Go</option>
      </Select>
      <span className="w-24 text-xs text-muted-foreground">
        {stored ? `= ${fmtBytes(Number(stored))}` : ''}
      </span>
      <Button variant="outline" size="sm" onClick={save}>
        {saved ? t('settings.savedTick') : t('common.save')}
      </Button>
    </div>
  );
}

/** Champ simple (valeur brute). */
function PlainField({
  field,
  stored,
  onSave,
}: {
  field: SettingField;
  stored: string;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const t = useT();
  const [value, setValue] = useState(stored);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    await onSave(field.key, value);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label className="w-64 text-muted-foreground">{t(field.labelKey)}</label>
      <Input
        className="flex-1 py-1 text-xs"
        placeholder={t(field.hintKey)}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button variant="outline" size="sm" onClick={save}>
        {saved ? t('settings.savedTick') : t('common.save')}
      </Button>
    </div>
  );
}

export default function SettingsTab() {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: qk.admin('settings'),
    queryFn: () =>
      api.get<{ settings: Record<string, string> }>('/api/studio/settings').then((d) => d.settings),
  });

  const persist = async (key: string, value: string) => {
    try {
      await api.put('/api/studio/settings', { key, value });
      void qc.invalidateQueries({ queryKey: qk.admin('settings') });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.save'));
    }
  };

  if (isLoading || !data) return <SkeletonRows count={5} />;
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-border p-3">
        {SETTINGS_FIELDS.map((f) =>
          f.bytes ? (
            <SizeField key={f.key} field={f} stored={data[f.key] ?? ''} onSave={persist} />
          ) : (
            <PlainField key={f.key} field={f} stored={data[f.key] ?? ''} onSave={persist} />
          ),
        )}
      </div>
      <TaskPolicyField stored={data.task_department_policy ?? ''} onSave={persist} />
      <DefaultLocaleField stored={data.studio_default_locale ?? ''} onSave={persist} />
      <AccentField stored={data.studio_accent ?? ''} onSave={persist} />
    </div>
  );
}

/**
 * Langue par défaut du studio : celle des comptes qui n'ont rien choisi, et celle des
 * emails envoyés à ces comptes. Le sélecteur ne change pas la langue de l'admin qui le
 * manipule — c'est un réglage d'instance, pas une préférence personnelle.
 */
function DefaultLocaleField({
  stored,
  onSave,
}: {
  stored: string;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const t = useT();
  const [value, setValue] = useState(isLocale(stored) ? stored : BASE_LOCALE);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <h3 className="text-sm font-semibold">{t('settings.studioLanguage')}</h3>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="w-64 text-muted-foreground" htmlFor="studio-default-locale">
          {t('reviewStatus.defaultLang')}
        </label>
        <Select
          id="studio-default-locale"
          className="py-1 text-xs"
          value={value}
          onChange={(e) => setValue(e.target.value as Locale)}
        >
          {LOCALES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.native} ({l.english}){l.regional ? ` ${t('language.regional')}` : ''}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="sm" onClick={() => onSave('studio_default_locale', value)}>
          {t('common.apply')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('settings.localeHint')}</p>
      <TranslationNotice />
    </div>
  );
}

/** Thème studio (42.B — №101) : couleur d'accent, appliquée à l'app + page de connexion. */
function AccentField({
  stored,
  onSave,
}: {
  stored: string;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const t = useT();
  const [value, setValue] = useState(/^#[0-9a-f]{6}$/i.test(stored) ? stored : '#00b3c4');
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <h3 className="text-sm font-semibold">{t('settings.studioTheme')}</h3>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="w-64 text-muted-foreground">{t('settings.accentColour')}</label>
        <input
          type="color"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent"
          aria-label={t('settings.accentColor')}
        />
        <span className="w-24 font-mono text-xs text-muted-foreground">{value}</span>
        <Button variant="outline" size="sm" onClick={() => onSave('studio_accent', value)}>
          {t('common.apply')}
        </Button>
        {stored && (
          <Button variant="ghost" size="sm" onClick={() => onSave('studio_accent', '')}>
            {t('common.reset')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('settings.accentHint')}</p>
    </div>
  );
}
