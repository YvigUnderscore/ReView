// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Input } from '../../components/ui/input';
import { Panel } from './AdminPrimitives';
import type { Nomenclature, ProjectSettings } from '../../types/api';
import { useT } from '../../i18n';

/** Un champ court des défauts : son libellé au-dessus, sa saisie en dessous. */
function DefField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-2xs section-label text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

/** Numérotation des séquences et des plans : préfixes, pas, nombre de chiffres. */
export function NumberingPanel({
  value,
  onChange,
}: {
  value: Nomenclature;
  onChange: (key: keyof Nomenclature, raw: string) => void;
}) {
  const t = useT();
  return (
    <Panel title={t('defaults.naming')}>
      <div className="flex flex-wrap items-end gap-3">
        <DefField label={t('pipeline.prefix.sequence')}>
          <Input
            className="w-24 py-1.5 text-xs"
            value={value.sequencePrefix}
            onChange={(e) => onChange('sequencePrefix', e.target.value)}
          />
        </DefField>
        <DefField label={t('pipeline.prefix.shot')}>
          <Input
            className="w-24 py-1.5 text-xs"
            value={value.shotPrefix}
            onChange={(e) => onChange('shotPrefix', e.target.value)}
          />
        </DefField>
        <DefField label={t('pipeline.step')}>
          <Input
            type="number"
            min={1}
            className="w-16 py-1.5 text-xs"
            value={String(value.step)}
            onChange={(e) => onChange('step', e.target.value)}
          />
        </DefField>
        <DefField label={t('pipeline.digits')}>
          <Input
            type="number"
            min={1}
            max={8}
            className="w-16 py-1.5 text-xs"
            value={String(value.padding)}
            onChange={(e) => onChange('padding', e.target.value)}
          />
        </DefField>
      </div>
    </Panel>
  );
}

/**
 * Format de livraison et cadence — et la **frame de départ**, qui traînait dans la section
 * fourre-tout alors qu'elle n'a de sens qu'à côté d'eux : ce sont les trois valeurs qu'un
 * nouveau plan reçoit à sa création.
 */
export function FormatPanel({
  value,
  onResolution,
  onFramerate,
  startFrame,
}: {
  value: Pick<ProjectSettings, 'resolution' | 'framerate'>;
  onResolution: (axis: 'width' | 'height', raw: string) => void;
  onFramerate: (raw: string) => void;
  /** Les champs clé/valeur de la section, rendus sous les dimensions. */
  startFrame: ReactNode;
}) {
  const t = useT();
  return (
    <Panel title={t('defaults.formatRate')}>
      <div className="flex flex-wrap items-end gap-3">
        <DefField label={t('pipeline.width')}>
          <Input
            type="number"
            min={1}
            className="w-24 py-1.5 text-xs"
            value={String(value.resolution.width)}
            onChange={(e) => onResolution('width', e.target.value)}
          />
        </DefField>
        <span className="pb-1.5 text-muted-foreground">×</span>
        <DefField label={t('pipeline.height')}>
          <Input
            type="number"
            min={1}
            className="w-24 py-1.5 text-xs"
            value={String(value.resolution.height)}
            onChange={(e) => onResolution('height', e.target.value)}
          />
        </DefField>
        <DefField label={t('pipeline.fps')}>
          <Input
            type="number"
            min={1}
            className="w-20 py-1.5 text-xs"
            value={String(value.framerate)}
            onChange={(e) => onFramerate(e.target.value)}
          />
        </DefField>
      </div>
      <div className="mt-3">{startFrame}</div>
    </Panel>
  );
}
