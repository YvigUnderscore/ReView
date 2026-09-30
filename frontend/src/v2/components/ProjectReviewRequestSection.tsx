// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { MessageSquareText } from 'lucide-react';
import { Hint } from './ui/hint';
import { SettingsCard } from './settings/SettingsCard';
import { SETTINGS_KEYWORDS } from './settings/settingsKeywords';
import type { ReviewRequestRule } from '../types/api';
import { useT } from '../i18n';

/** Les bornes du plancher, miroir de `lib/projectSettings` côté serveur. */
const MIN = 1;
const MAX = 280;

/**
 * Ce que le projet exige quand quelqu'un est tagué comme ReViewer d'un média.
 *
 * Deux réglages, et un seul geste à comprendre : exiger la consigne, et dire à partir de
 * combien de caractères elle en est une. Le second reste réglable même quand le premier est
 * éteint — le plancher s'applique à toute consigne écrite, et un studio qui n'impose rien
 * veut quand même écarter « ok ».
 *
 * Rendu à deux endroits : l'onglet Réglages d'un projet, et les défauts studio dont il
 * hérite. Un seul composant pour les deux, comme la convention de nommage.
 */
export default function ProjectReviewRequestSection({
  value,
  onChange,
}: {
  value: ReviewRequestRule;
  onChange: (rule: ReviewRequestRule) => void;
}) {
  const t = useT();

  return (
    <SettingsCard
      title={t('reviewRequest.title')}
      hint={t('reviewRequest.hint')}
      icon={MessageSquareText}
      tone="info"
      keywords={SETTINGS_KEYWORDS.reviewRequest}
    >
      <div className="flex items-center justify-between gap-4">
        <label className="text-sm" htmlFor="review-request-require">
          {t('reviewRequest.require')}
          <span className="block text-xs text-muted-foreground">{t('reviewRequest.requireHint')}</span>
        </label>
        <Switch
          id="review-request-require"
          checked={value.requireNote}
          onCheckedChange={(requireNote) => onChange({ ...value, requireNote })}
          label={t('reviewRequest.require')}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-2xs section-label text-muted-foreground">
          {t('reviewRequest.minLength')}
          <Input
            type="number"
            min={MIN}
            max={MAX}
            className="w-24 py-1.5 text-xs"
            value={String(value.minNoteLength)}
            onChange={(e) =>
              onChange({
                ...value,
                // Un champ vidé au clavier ne doit pas écrire `NaN` dans les réglages du
                // studio : on retombe sur le plancher le temps que la saisie reprenne.
                minNoteLength: Math.min(Math.max(Number(e.target.value) || MIN, MIN), MAX),
              })
            }
          />
        </label>
        <Hint className="flex-1">{t('reviewRequest.minLengthHint')}</Hint>
      </div>
    </SettingsCard>
  );
}
