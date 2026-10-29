// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { LayoutGrid, List, Monitor, Moon, Sun, Rows3, Rows4, MonitorCog } from 'lucide-react';
import { useTheme, type ThemeMode } from '../stores/useTheme';
import { useDensity, type Density } from '../stores/useDensity';
import { useViewPref, type ViewMode } from '../stores/useViewPref';
import { useT } from '../i18n';
import { useUpdatePreferences } from '../lib/usePreferences';
import LanguagePicker from './LanguagePicker';
import TranslationNotice from './TranslationNotice';
import { SegmentedControl, type SegmentedItem } from './ui/segmented-control';
import { SettingsCard } from './settings/SettingsCard';
import { SETTINGS_KEYWORDS } from './settings/settingsKeywords';
import SettingsRow from './settings/SettingsRow';

/**
 * Display settings (42.A1): theme (system/light/dark, №102), density (№74), default view
 * for lists and language. Local customization (localStorage), applied
 * instantly without flash.
 *
 * The panel redefined **its own** segmented control while `ui/segmented-control`
 * exists and serves four other screens: two designs for the same gesture, on the page that
 * everyone opens first. It now uses the shared primitive.
 */
export default function DisplaySettings() {
  const t = useT();
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  const density = useDensity((s) => s.density);
  const setDensity = useDensity((s) => s.setDensity);
  // The theme stays specific to the device (a workstation may be in a dark room); the language and
  // density follow the account: the server uses the language for emails, and
  // resetting to comfortable on each new workstation was a needless annoyance (A2).
  const updatePrefs = useUpdatePreferences();
  // Default view of all lists. A list with its own setting keeps its
  // own: that is what a deviation means, and lifting it is done from the list.
  const viewGlobal = useViewPref((s) => s.global);
  const setViewGlobal = useViewPref((s) => s.setGlobal);

  const themeOpts: SegmentedItem<ThemeMode>[] = [
    { value: 'system', label: t('display.theme.system'), icon: Monitor },
    { value: 'light', label: t('display.theme.light'), icon: Sun },
    { value: 'dark', label: t('display.theme.dark'), icon: Moon },
  ];
  const densityOpts: SegmentedItem<Density>[] = [
    { value: 'comfortable', label: t('display.density.comfortable'), icon: Rows3 },
    { value: 'compact', label: t('display.density.compact'), icon: Rows4 },
  ];
  const viewOpts: SegmentedItem<ViewMode>[] = [
    { value: 'cards', label: t('view.cards'), icon: LayoutGrid },
    { value: 'compact', label: t('view.compact'), icon: List },
  ];
  return (
    <SettingsCard
      title={t('display.title')}
      icon={MonitorCog}
      tone="info"
      keywords={SETTINGS_KEYWORDS.display}
    >
      <SettingsRow label={t('display.theme')}>
        <SegmentedControl items={themeOpts} value={mode} onChange={setMode} label={t('display.theme')} />
      </SettingsRow>
      <SettingsRow label={t('display.density')} hint={t('display.density.hint')}>
        <SegmentedControl
          items={densityOpts}
          value={density}
          onChange={(d) => {
            setDensity(d);
            updatePrefs.mutate({ density: d });
          }}
          label={t('display.density')}
        />
      </SettingsRow>
      <SettingsRow label={t('display.view')} hint={t('display.view.hint')}>
        <SegmentedControl
          items={viewOpts}
          value={viewGlobal ?? 'cards'}
          onChange={setViewGlobal}
          label={t('display.view')}
        />
      </SettingsRow>
      <SettingsRow label={t('display.language')} hint={t('display.language.hint')}>
        <LanguagePicker
          id="display-language"
          className="py-1 text-xs"
          onSelect={(locale) => updatePrefs.mutate({ locale })}
        />
      </SettingsRow>
      <TranslationNotice />
    </SettingsCard>
  );
}
