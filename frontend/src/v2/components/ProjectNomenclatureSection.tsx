// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Nomenclature } from '../types/api';
import { useT } from '../i18n';
import ProjectSettingsField from './ProjectSettingsField';
import { SkeletonRows } from './ui/skeleton';
import { Tags } from 'lucide-react';
import { SettingsCard } from './settings/SettingsCard';
import { SETTINGS_KEYWORDS } from './settings/settingsKeywords';

/**
 * Nomenclature du projet : préfixes de séquence et de plan, pas de numérotation, nombre de
 * chiffres. Override des défauts du studio, édité dans le brouillon de réglages.
 *
 * `value` peut être nul le temps que les réglages effectifs arrivent : la carte garde sa
 * place avec son squelette.
 */
export default function ProjectNomenclatureSection({
  value,
  onChange,
}: {
  value: Nomenclature | null;
  onChange: (nomenclature: Nomenclature) => void;
}) {
  const t = useT();

  /** `padding` et `step` sont des nombres — un préfixe vidé, lui, reste une chaîne vide. */
  const set = (k: keyof Nomenclature, raw: string) => {
    if (!value) return;
    onChange({ ...value, [k]: k === 'padding' || k === 'step' ? Number(raw) || 1 : raw });
  };

  return (
    <SettingsCard
      title={t('pipeline.nomenclature')}
      hint={t('project.namingOverride')}
      icon={Tags}
      tone="accent"
      keywords={SETTINGS_KEYWORDS.nomenclature}
    >
      {value ? (
        <div className="flex flex-wrap items-end gap-3">
          <ProjectSettingsField label={t('pipeline.prefix.sequence')}>
            <input
              className="w-24 rounded border border-input bg-background px-2 py-1.5 text-xs"
              value={value.sequencePrefix}
              onChange={(e) => set('sequencePrefix', e.target.value)}
            />
          </ProjectSettingsField>
          <ProjectSettingsField label={t('pipeline.prefix.shot')}>
            <input
              className="w-24 rounded border border-input bg-background px-2 py-1.5 text-xs"
              value={value.shotPrefix}
              onChange={(e) => set('shotPrefix', e.target.value)}
            />
          </ProjectSettingsField>
          <ProjectSettingsField label={t('pipeline.step')}>
            <input
              type="number"
              min={1}
              className="w-16 rounded border border-input bg-background px-2 py-1.5 text-xs"
              value={value.step}
              onChange={(e) => set('step', e.target.value)}
            />
          </ProjectSettingsField>
          <ProjectSettingsField label={t('pipeline.digits')}>
            <input
              type="number"
              min={1}
              max={8}
              className="w-16 rounded border border-input bg-background px-2 py-1.5 text-xs"
              value={value.padding}
              onChange={(e) => set('padding', e.target.value)}
            />
          </ProjectSettingsField>
        </div>
      ) : (
        <SkeletonRows count={3} />
      )}
    </SettingsCard>
  );
}
