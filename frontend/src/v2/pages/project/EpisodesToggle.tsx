// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { toast } from 'sonner';
import { Switch } from '../../components/ui/switch';
import { setEpisodesEnabled, useEpisodeInvalidate, useEpisodeSettings } from '../../lib/episodesApi';
import { useT } from '../../i18n';

/**
 * L'interrupteur du niveau Épisode, dans les réglages du projet.
 *
 * C'est le seul endroit d'où le niveau s'allume : l'onglet Épisodes n'existe pas tant
 * qu'il est éteint, il ne pouvait donc pas porter sa propre bascule.
 *
 * Éteindre ne détruit rien — ni les épisodes, ni les rattachements. Le dire ici, avec le
 * décompte de ce qui va être masqué, évite d'avoir à le deviner : un interrupteur dont on
 * ignore s'il efface ne s'actionne pas.
 */
export default function EpisodesToggle({ projectId }: { projectId: number }) {
  const t = useT();
  const { data: settings } = useEpisodeSettings(projectId);
  const invalidate = useEpisodeInvalidate(projectId);
  const [saving, setSaving] = useState(false);

  if (!settings) return null;

  const change = async (next: boolean) => {
    setSaving(true);
    try {
      await setEpisodesEnabled(projectId, next);
      await invalidate();
      toast.success(next ? t('episodes.settings.enabled') : t('episodes.settings.disabled'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{t('episodes.settings.title')}</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('episodes.settings.description')}</p>
        </div>
        <Switch
          checked={settings.enabled}
          disabled={saving}
          label={t('episodes.settings.toggle')}
          onCheckedChange={(next) => void change(next)}
        />
      </div>
      {settings.episodeCount > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t('episodes.settings.stored', { count: settings.episodeCount })} ·{' '}
          {t('episodes.settings.linked', { count: settings.linkedSequenceCount })}
        </p>
      )}
      {settings.enabled && settings.episodeCount > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">{t('episodes.settings.keepsData')}</p>
      )}
    </section>
  );
}
