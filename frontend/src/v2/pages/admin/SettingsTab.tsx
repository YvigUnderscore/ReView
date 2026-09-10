// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { SkeletonRows } from '../../components/ui/skeleton';
import { QueryState } from '../../components/ui/query-state';
import TranslationNotice from '../../components/TranslationNotice';
import { BASE_LOCALE, LOCALES, isLocale, useT } from '../../i18n';
import { Panel } from './AdminPrimitives';
import SaveBar from './SaveBar';
import SettingsFields from './SettingsFields';
import StudioLogoPanel from './StudioLogoPanel';
import { useSaveAction, useStudioRow, useStudioSettings } from './useStudioSettings';

const ACCENT_FALLBACK = '#00b3c4';
const ACCENT_RE = /^#[0-9a-f]{6}$/i;

/**
 * « Identité du studio » — ce qui dit de quelle maison l'instance est le miroir : son nom,
 * sa couleur, sa langue par défaut, son logo, et l'adresse de ses sources (AGPL §13).
 *
 * C'était la section fourre-tout : quatorze réglages sans rapport et onze boutons
 * « Enregistrer ». Les quotas sont partis dans « Stockage », la rétention dans
 * « Rétention », les cadences dans « Salle live », Slack dans « Messagerie d'équipe » et la
 * frame de départ dans « Défauts de projet » — chacun là où on le cherche. Ne restent ici
 * que les réglages qu'on vient chercher **au nom du studio**, sous une barre unique.
 *
 * Le nom du studio n'avait aucun écran alors que l'API l'expose depuis toujours : il se
 * réglait à la main en base. Il ouvre désormais la page.
 */
export default function SettingsTab() {
  const t = useT();
  const qc = useQueryClient();
  const settings = useStudioSettings('settings');
  const studioQ = useStudioRow();

  // Le nom vit sur la ligne Studio (PATCH /api/studio), pas dans la table clé/valeur : il a
  // son propre brouillon, mais partage la barre d'enregistrement de la page.
  const [name, setName] = useState<string | null>(null);
  const storedName = studioQ.data?.name ?? '';
  const nameDirty = name !== null && name !== storedName;

  const { busy, save } = useSaveAction(async () => {
    // Le nom d'abord : c'est le seul champ que le serveur peut refuser (longueur), et un
    // refus doit laisser la page intacte plutôt qu'à moitié enregistrée.
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
        <Panel title={t('settings.group.studio')}>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="w-64 text-muted-foreground" htmlFor="studio-name">
                {t('settings.studioName')}
              </label>
              <Input
                id="studio-name"
                className="flex-1 py-1 text-xs"
                placeholder={t('settings.hint.studioName')}
                value={name ?? storedName}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <SettingsFields
              fields={settings.fields}
              stored={stored}
              draft={settings.draft}
              units={settings.units}
              onChange={settings.setValue}
              onUnit={settings.setUnit}
            />
          </div>
        </Panel>

        <Panel title={t('settings.studioTheme')}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="w-64 text-muted-foreground" htmlFor="studio-accent">
              {t('settings.accentColour')}
            </label>
            <input
              id="studio-accent"
              type="color"
              value={accentValue}
              onChange={(e) => settings.setValue('studio_accent', e.target.value)}
              className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent"
            />
            <span className="w-24 font-mono text-xs text-muted-foreground">{accentValue}</span>
            {accent && (
              <Button variant="ghost" size="sm" onClick={() => settings.setValue('studio_accent', '')}>
                {t('common.reset')}
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('settings.accentHint')}</p>
        </Panel>

        <Panel title={t('settings.studioLanguage')}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="w-64 text-muted-foreground" htmlFor="studio-default-locale">
              {t('reviewStatus.defaultLang')}
            </label>
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
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('settings.localeHint')}</p>
          <TranslationNotice />
        </Panel>

        {/* Le logo est un dépôt de fichier : il s'enregistre de lui-même, la barre ne peut
            rien pour lui. Il vit ici parce que c'est la marque du studio — les slates, les
            burn-ins et la page de connexion la reprennent, aucun ne la possède. */}
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
