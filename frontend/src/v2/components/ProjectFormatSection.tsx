// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PipelineSettings, Resolution } from '../types/api';
import { useT } from '../i18n';
import ProjectSettingsField from './ProjectSettingsField';
import { SkeletonRows } from './ui/skeleton';
import { Card } from './ui/card';

/**
 * Format & cadence du projet : résolution de livraison + framerate. Ce sont les défauts
 * hérités par les séquences et les plans (sans colorspace, réglé au niveau studio).
 *
 * Édite le brouillon de réglages ; enregistré avec lui. `value` peut être nul le temps que
 * les réglages effectifs arrivent : la carte reste en place avec son squelette, plutôt que
 * d'apparaître d'un coup au milieu de la colonne.
 */
export default function ProjectFormatSection({
  value,
  onChange,
}: {
  value: PipelineSettings | null;
  onChange: (pipeline: PipelineSettings) => void;
}) {
  const t = useT();

  // On ne rend QUE les deux champs du pipeline : l'appelant nous passe les réglages
  // effectifs, dont ceux des autres sections — les réémettre en bloc les ferait remonter.
  const setRes = (k: keyof Resolution, raw: string) => {
    if (!value) return;
    onChange({
      framerate: value.framerate,
      resolution: { ...value.resolution, [k]: Number(raw) || 1 },
    });
  };
  const setFps = (raw: string) => {
    if (!value) return;
    onChange({ resolution: value.resolution, framerate: Number(raw) || 1 });
  };

  return (
    <Card>
      <div className="text-sm font-medium">{t('pipeline.formatRate')}</div>
      <div className="mb-3 text-xs text-muted-foreground">{t('pipeline.formatHint')}</div>
      {value ? (
        <div className="flex flex-wrap items-end gap-3">
          <ProjectSettingsField label={t('pipeline.width')}>
            <input
              type="number"
              min={1}
              className="w-24 rounded border border-input bg-background px-2 py-1.5 text-xs"
              value={value.resolution.width}
              onChange={(e) => setRes('width', e.target.value)}
            />
          </ProjectSettingsField>
          <span className="pb-1.5 text-muted-foreground">×</span>
          <ProjectSettingsField label={t('pipeline.height')}>
            <input
              type="number"
              min={1}
              className="w-24 rounded border border-input bg-background px-2 py-1.5 text-xs"
              value={value.resolution.height}
              onChange={(e) => setRes('height', e.target.value)}
            />
          </ProjectSettingsField>
          <ProjectSettingsField label={t('pipeline.fps')}>
            <input
              type="number"
              min={1}
              className="w-20 rounded border border-input bg-background px-2 py-1.5 text-xs"
              value={value.framerate}
              onChange={(e) => setFps(e.target.value)}
            />
          </ProjectSettingsField>
        </div>
      ) : (
        <SkeletonRows count={1} />
      )}
    </Card>
  );
}
