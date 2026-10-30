// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Input } from '../../components/ui/input';
import { Panel } from './AdminPrimitives';
import type { Nomenclature, ProjectSettings } from '../../types/api';
import { useT } from '../../i18n';

/** A short default field: its label above, its input below. */
function DefField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-2xs section-label text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

/** Numbering of sequences and shots: prefixes, steps, number of digits. */
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
 * Delivery format and cadence — and the **start frame**, which was lingering in the catch-all section
 * although it only makes sense next to them: they are the three values a
 * new shot receives when it is created.
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
  /** The key/value fields of the section, rendered under the dimensions. */
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
