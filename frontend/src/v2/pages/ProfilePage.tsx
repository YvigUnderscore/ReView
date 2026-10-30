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
 * Account settings.
 *
 * Same composition as the studio's and the project's settings: a title, a search
 * bar, then a column of cards of the same make. Until now the page stacked eight
 * cards with no way to search — "where do I change the language" was answered by scrolling
 * the column, whereas administration could answer the question from its bar.
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
            {/* Settings per event type (batch 9): the rest of this card only covered
                recurring sends and the browser subscription. */}
            <NotificationSettings />
          </SettingsCard>

          {/* Account security (36.A/36.B/36.C): 2FA + active sessions + API tokens. */}
          <TwoFaSection />
          <SessionsSection />
          <ApiTokensSection />

          <SettingsSearchEmpty />
        </div>
      </SettingsSearchProvider>
    </PageShell>
  );
}
