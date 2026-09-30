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
 * Réglages d'affichage (42.A1) : thème (système/clair/sombre — №102), densité (№74), vue
 * par défaut des listes et langue. Personnalisation locale (localStorage), appliquée
 * instantanément sans flash.
 *
 * Le panneau redéfinissait **son propre** contrôle segmenté alors que `ui/segmented-control`
 * existe et sert quatre autres écrans : deux dessins pour un même geste, sur la page que
 * chacun ouvre en premier. Il emploie désormais la primitive partagée.
 */
export default function DisplaySettings() {
  const t = useT();
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  const density = useDensity((s) => s.density);
  const setDensity = useDensity((s) => s.setDensity);
  // Le thème reste propre à l'appareil (un poste peut être en salle sombre) ; la langue et
  // la densité suivent le compte — le serveur se sert de la langue pour les emails, et
  // repartir en confortable sur chaque nouveau poste était une contrariété inutile (A2).
  const updatePrefs = useUpdatePreferences();
  // Vue par défaut de toutes les listes. Une liste qui a son propre réglage garde le
  // sien : c'est ce qu'un écart veut dire, et le lever se fait depuis la liste.
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
