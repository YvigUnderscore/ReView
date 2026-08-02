// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Input } from '../../components/ui/input';
import type { PipelineSettings } from '../../types/api';
import type { PipelineForm } from './pipelineForm';
import { useT } from '../../i18n';

/**
 * Champs de réglage pipeline (résolution + cadence) avec bascule hériter/personnaliser.
 * En mode hérité, affiche la valeur du parent ; en mode personnalisé, édite l'override.
 * Réutilisé par l'édition de séquence et de shot (Phase 19).
 */
export default function PipelineFields({
  inherited,
  form,
  onChange,
  idPrefix = 'pipe',
}: {
  inherited: PipelineSettings;
  form: PipelineForm;
  onChange: (f: PipelineForm) => void;
  idPrefix?: string;
}) {
  const t = useT();
  const set = (patch: Partial<PipelineForm>) => onChange({ ...form, ...patch });

  return (
    <div className="space-y-2 rounded-md border border-border bg-background/40 p-3">
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          className="accent-primary"
          checked={form.custom}
          onChange={(e) => set({ custom: e.target.checked })}
        />
        <span className="font-medium">{t('pipeline.customise')}</span>
      </label>

      {form.custom ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('pipeline.width')}>
            <Input
              id={`${idPrefix}-w`}
              type="number"
              min={1}
              className="w-24 px-2 py-1.5 text-xs"
              value={form.width}
              onChange={(e) => set({ width: e.target.value })}
            />
          </Field>
          <span className="pb-1.5 text-muted-foreground">×</span>
          <Field label={t('pipeline.height')}>
            <Input
              id={`${idPrefix}-h`}
              type="number"
              min={1}
              className="w-24 px-2 py-1.5 text-xs"
              value={form.height}
              onChange={(e) => set({ height: e.target.value })}
            />
          </Field>
          <Field label={t('pipeline.fps')}>
            <Input
              id={`${idPrefix}-fps`}
              type="number"
              min={1}
              className="w-20 px-2 py-1.5 text-xs"
              value={form.framerate}
              onChange={(e) => set({ framerate: e.target.value })}
            />
          </Field>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Hérité du parent : {inherited.resolution.width}×{inherited.resolution.height}, {inherited.framerate}{' '}
          fps
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
