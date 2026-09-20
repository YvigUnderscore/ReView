// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Bell } from 'lucide-react';
import PageShell from '../components/PageShell';
import DisplaySettings from '../components/DisplaySettings';
import { SettingsCard } from '../components/settings/SettingsCard';
import { SETTINGS_KEYWORDS } from '../components/settings/settingsKeywords';
import {
  SettingsSearchBar,
  SettingsSearchEmpty,
  SettingsSearchProvider,
} from '../components/settings/SettingsSearch';
import AccountSections from './profile/AccountSections';
import PushToggle from './profile/PushToggle';
import { DigestToggle, WeeklyReportToggle } from './profile/EmailToggles';
import NotificationSettings from './profile/NotificationSettings';
import SessionsSection from './profile/SessionsSection';
import ApiTokensSection from './profile/ApiTokensSection';
import TwoFaSection from './profile/TwoFaSection';
import { useT } from '../i18n';

/**
 * Les réglages du compte.
 *
 * Même composition que les réglages d'un studio et ceux d'un projet : un titre, une barre
 * de recherche, puis une colonne de cartes de même facture. La page empilait jusqu'ici huit
 * cartes sans moyen de chercher — « où change-t-on la langue » se résolvait en descendant
 * la colonne, alors que l'administration savait répondre à la question depuis sa barre.
 */
export default function ProfilePage() {
  const t = useT();
  return (
    <PageShell>
      <SettingsSearchProvider>
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-semibold">{t('profile.title')}</h1>
            <SettingsSearchBar className="w-full sm:w-64" />
          </div>

          <AccountSections />
          <DisplaySettings />

          <SettingsCard
            title={t('profile.notifications')}
            icon={Bell}
            tone="accent"
            keywords={SETTINGS_KEYWORDS.notifications}
          >
            <DigestToggle />
            <WeeklyReportToggle />
            <PushToggle />
            {/* Réglages par type d'événement (lot 9) : le reste de cette carte ne couvrait
                que les envois récurrents et l'abonnement du navigateur. */}
            <NotificationSettings />
          </SettingsCard>

          {/* Sécurité du compte (36.A/36.B/36.C) : 2FA + sessions actives + tokens d'API. */}
          <TwoFaSection />
          <SessionsSection />
          <ApiTokensSection />

          <SettingsSearchEmpty />
        </div>
      </SettingsSearchProvider>
    </PageShell>
  );
}
