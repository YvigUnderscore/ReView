// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { SkeletonRows } from '../../components/ui/skeleton';
import { QueryState } from '../../components/ui/query-state';
import TranslationNotice from '../../components/TranslationNotice';
import { BASE_LOCALE, LOCALES, isLocale, useT } from '../../i18n';
import { Building2, Languages, Palette } from 'lucide-react';
import { Panel } from './AdminPrimitives';
import SettingsRow from '../../components/settings/SettingsRow';
import SaveBar from './SaveBar';
import SettingsFields from './SettingsFields';
import StudioLogoPanel from './StudioLogoPanel';
import { useSaveAction, useStudioRow, useStudioSettings } from './useStudioSettings';

const ACCENT_FALLBACK = '#00b3c4';
const ACCENT_RE = /^#[0-9a-f]{6}$/i;

/**
 * "Studio identity": what says which house the instance mirrors: its name,
 * colour, default language, logo, and the address of its sources (AGPL §13).
 *
 * This was the catch-all section: fourteen unrelated settings and eleven
 * "Save" buttons. Quotas moved to "Storage", retention to
 * "Retention", cadences to "Live room", Slack to "Team messaging" and the
 * start frame to "Project defaults" — each where one looks for it. Only the
 * settings one comes looking for **on behalf of the studio** remain here, under a single bar.
 *
 * The studio name had no screen although the API has always exposed it: it was
 * set by hand in the database. It now has a place on this page.
 */
export default function SettingsTab() {
  const t = useT();
  const qc = useQueryClient();
  const settings = useStudioSettings('settings');
  const studioQ = useStudioRow();

  // The name lives on the Studio row (PATCH /api/studio), not in the key/value table: it has
  // its own draft, but shares the page's save bar.
  const [name, setName] = useState<string | null>(null);
  const storedName = studioQ.data?.name ?? '';
  const nameDirty = name !== null && name !== storedName;

  const { busy, save } = useSaveAction(async () => {
    // The name first: it is the only field the server may refuse (length), and a
    // refusal must leave the page intact rather than half-saved.
    if (nameDirty) {
      await api.patch('/api/studio', { name });
      await qc.invalidateQueries({ queryKey: qk.admin('studio') });
      setName(null);
    }
    await settings.commit();
  });

  const discard = () => {
    setName(null);
    settings.discard();
  };

  const stored = settings.stored;
  const accent = settings.draft.studio_accent ?? stored.studio_accent ?? '';
  const accentValue = ACCENT_RE.test(accent) ? accent : ACCENT_FALLBACK;
  const locale = settings.draft.studio_default_locale ?? stored.studio_default_locale ?? '';

  if (!settings.query.data) {
    return <QueryState query={settings.query} skeleton={<SkeletonRows count={5} />} />;
  }

  return (
    <div className="max-w-2xl">
      <div className="space-y-4">
        <Panel title={t('settings.group.studio')} icon={Building2} tone="primary">
          <SettingsRow label={t('settings.studioName')} htmlFor="studio-name">
            <Input
              id="studio-name"
              className="min-w-48 flex-1 py-1 text-xs"
              placeholder={t('settings.hint.studioName')}
              value={name ?? storedName}
              onChange={(e) => setName(e.target.value)}
            />
          </SettingsRow>
          <SettingsFields
            fields={settings.fields}
            stored={stored}
            draft={settings.draft}
            units={settings.units}
            onChange={settings.setValue}
            onUnit={settings.setUnit}
          />
        </Panel>

        <Panel
          title={t('settings.studioTheme')}
          icon={Palette}
          tone="accent"
          footnote={t('settings.accentHint')}
        >
          <SettingsRow label={t('settings.accentColour')} htmlFor="studio-accent">
            <div className="flex items-center gap-2">
              <input
                id="studio-accent"
                type="color"
                value={accentValue}
                onChange={(e) => settings.setValue('studio_accent', e.target.value)}
                className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent"
              />
              <span className="font-mono text-2xs text-muted-foreground">{accentValue}</span>
              {accent && (
                <Button variant="ghost" size="sm" onClick={() => settings.setValue('studio_accent', '')}>
                  {t('common.reset')}
                </Button>
              )}
            </div>
          </SettingsRow>
        </Panel>

        <Panel
          title={t('settings.studioLanguage')}
          icon={Languages}
          tone="info"
          footnote={t('settings.localeHint')}
        >
          <SettingsRow label={t('reviewStatus.defaultLang')} htmlFor="studio-default-locale">
            <Select
              id="studio-default-locale"
              className="py-1 text-xs"
              value={isLocale(locale) ? locale : BASE_LOCALE}
              onChange={(e) => settings.setValue('studio_default_locale', e.target.value)}
            >
              {LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.native} ({l.english}){l.regional ? ` ${t('language.regionalSuffix')}` : ''}
                </option>
              ))}
            </Select>
          </SettingsRow>
          <TranslationNotice />
        </Panel>

        {/* The logo is a file upload: it saves on its own, the bar can do
            nothing for it. It lives here because it is the studio's brand — the slates, the
            burn-ins and the login page reuse it, none of them owns it. */}
        <StudioLogoPanel />
      </div>

      <SaveBar
        dirty={settings.dirty || nameDirty}
        busy={busy}
        onSave={() => void save()}
        onDiscard={discard}
      />
    </div>
  );
}
