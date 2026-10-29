// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PipelineSettings, Resolution } from '../types/api';
import { useT } from '../i18n';
import ProjectSettingsField from './ProjectSettingsField';
import { SkeletonRows } from './ui/skeleton';
import { Ruler } from 'lucide-react';
import { SettingsCard } from './settings/SettingsCard';
import { SETTINGS_KEYWORDS } from './settings/settingsKeywords';

/**
 * Project format and frame rate: delivery resolution + framerate. These are the defaults
 * inherited by sequences and shots (without colorspace, which is set at studio level).
 *
 * Edits the settings draft; saved with it. `value` may be null while the
 * effective settings arrive: the card stays in place with its skeleton, rather than
 * appearing all at once in the middle of the column.
 */
export default function ProjectFormatSection({
  value,
  onChange,
}: {
  value: PipelineSettings | null;
  onChange: (pipeline: PipelineSettings) => void;
}) {
  const t = useT();

  // We render ONLY the two pipeline fields: the caller passes us the effective settings,
  // including those of the other sections; re-emitting them in bulk would make them come back.
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
    <SettingsCard
      title={t('pipeline.formatRate')}
      hint={t('pipeline.formatHint')}
      icon={Ruler}
      tone="info"
      keywords={SETTINGS_KEYWORDS.format}
    >
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
    </SettingsCard>
  );
}
