// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SkeletonRows } from '../../components/ui/skeleton';
import DepartmentsEditor from '../../components/DepartmentsEditor';
import { Panel } from './AdminPrimitives';
import type { Nomenclature, ProjectSettings } from '../../types/api';
import { useT } from '../../i18n';

function DefField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

/** Défauts de création de projet : nomenclature + départements (overridables par projet). */
export default function ProjectDefaultsTab() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.admin('project-defaults'),
    queryFn: () =>
      api.get<{ settings: ProjectSettings }>('/api/admin/project-defaults').then((d) => d.settings),
  });
  const [draft, setDraft] = useState<ProjectSettings | null>(null);
  const [busy, setBusy] = useState(false);
  // Amorce l'édition depuis les valeurs serveur (ajustement d'état pendant le render).
  if (data && !draft) setDraft(data);
  if (!draft) return <SkeletonRows count={3} />;

  const setNom = (k: keyof Nomenclature, v: string) =>
    setDraft(
      (d) =>
        d && {
          ...d,
          nomenclature: { ...d.nomenclature, [k]: k === 'padding' || k === 'step' ? Number(v) || 1 : v },
        },
    );
  const setRes = (k: 'width' | 'height', v: string) =>
    setDraft((d) => d && { ...d, resolution: { ...d.resolution, [k]: Number(v) || 1 } });
  const setFps = (v: string) => setDraft((d) => d && { ...d, framerate: Number(v) || 1 });
  const save = async () => {
    setBusy(true);
    try {
      const { settings } = await api.put<{ settings: ProjectSettings }>('/api/admin/project-defaults', draft);
      setDraft(settings);
      void qc.invalidateQueries({ queryKey: qk.admin('project-defaults') });
      toast.success(t('defaults.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error.save'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-sm text-muted-foreground">{t('defaults.hint')}</p>

      <Panel title={t('defaults.naming')}>
        <div className="flex flex-wrap items-end gap-3">
          <DefField label={t('pipeline.prefix.sequence')}>
            <Input
              className="w-24 py-1.5 text-xs"
              value={draft.nomenclature.sequencePrefix}
              onChange={(e) => setNom('sequencePrefix', e.target.value)}
            />
          </DefField>
          <DefField label={t('pipeline.prefix.shot')}>
            <Input
              className="w-24 py-1.5 text-xs"
              value={draft.nomenclature.shotPrefix}
              onChange={(e) => setNom('shotPrefix', e.target.value)}
            />
          </DefField>
          <DefField label={t('pipeline.step')}>
            <Input
              type="number"
              min={1}
              className="w-16 py-1.5 text-xs"
              value={String(draft.nomenclature.step)}
              onChange={(e) => setNom('step', e.target.value)}
            />
          </DefField>
          <DefField label={t('pipeline.digits')}>
            <Input
              type="number"
              min={1}
              max={8}
              className="w-16 py-1.5 text-xs"
              value={String(draft.nomenclature.padding)}
              onChange={(e) => setNom('padding', e.target.value)}
            />
          </DefField>
        </div>
      </Panel>

      <Panel title={t('defaults.formatRate')}>
        <div className="flex flex-wrap items-end gap-3">
          <DefField label={t('pipeline.width')}>
            <Input
              type="number"
              min={1}
              className="w-24 py-1.5 text-xs"
              value={String(draft.resolution.width)}
              onChange={(e) => setRes('width', e.target.value)}
            />
          </DefField>
          <span className="pb-1.5 text-muted-foreground">×</span>
          <DefField label={t('pipeline.height')}>
            <Input
              type="number"
              min={1}
              className="w-24 py-1.5 text-xs"
              value={String(draft.resolution.height)}
              onChange={(e) => setRes('height', e.target.value)}
            />
          </DefField>
          <DefField label={t('pipeline.fps')}>
            <Input
              type="number"
              min={1}
              className="w-20 py-1.5 text-xs"
              value={String(draft.framerate)}
              onChange={(e) => setFps(e.target.value)}
            />
          </DefField>
        </div>
      </Panel>

      <Panel title={t('defaults.departments')}>
        <DepartmentsEditor
          value={draft.departments}
          onChange={(departments) => setDraft((d) => d && { ...d, departments })}
        />
      </Panel>

      <Button onClick={save} disabled={busy}>
        <Save size={15} /> {busy ? 'Enregistrement…' : t('defaults.save')}
      </Button>
    </div>
  );
}
