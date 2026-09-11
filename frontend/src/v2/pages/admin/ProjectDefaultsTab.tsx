// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { SkeletonRows } from '../../components/ui/skeleton';
import { QueryState } from '../../components/ui/query-state';
import DepartmentsEditor from '../../components/DepartmentsEditor';
import ProjectNamingSection from '../../components/ProjectNamingSection';
import ProjectReviewRequestSection from '../../components/ProjectReviewRequestSection';
import ProjectDefaultLightingSection from '../../components/ProjectDefaultLightingSection';
import ProjectColorSection from '../../components/ProjectColorSection';
import { sameValue } from '../../lib/projectInheritance';
import { Panel } from './AdminPrimitives';
import { FormatPanel, NumberingPanel } from './ProjectDefaultsFields';
import SaveBar from './SaveBar';
import SettingsFields from './SettingsFields';
import SettingsPointer from './SettingsPointer';
import TaskPolicyField, { TASK_POLICY_KEY } from './TaskPolicyField';
import { useSaveAction, useStudioSettings } from './useStudioSettings';
import type { Nomenclature, ProjectSettings } from '../../types/api';
import { useT } from '../../i18n';

/**
 * Défauts de projet : ce dont hérite un projet tant qu'il ne s'en approprie pas.
 *
 * L'écran n'exposait que trois des sept sections réellement héritables — numérotation,
 * format, départements. Les quatre autres (convention de nommage, éclairage 3D, couleur,
 * burn-ins) apparaissaient côté projet, badge « HÉRITÉ DU STUDIO » à l'appui, en désignant
 * un studio qu'aucun écran ne permettait de régler. Les sept sont ici.
 *
 * La septième, les burn-ins, ne se règle pas ici : le template studio vit dans
 * « Diffusion », qui en est le propriétaire. L'écran y renvoie plutôt que d'en offrir une
 * seconde copie — deux champs pour une valeur, c'est une valeur qu'on croit avoir changée.
 */
export default function ProjectDefaultsTab() {
  const t = useT();
  const qc = useQueryClient();
  const defaultsQ = useQuery({
    queryKey: qk.admin('project-defaults'),
    queryFn: () =>
      api.get<{ settings: ProjectSettings }>('/api/admin/project-defaults').then((d) => d.settings),
  });
  const settings = useStudioSettings('defaults');
  const [draft, setDraft] = useState<ProjectSettings | null>(null);
  const saved = defaultsQ.data;

  const { busy, save } = useSaveAction(async () => {
    if (draft && saved && !sameValue(saved, draft)) {
      const { settings: fresh } = await api.put<{ settings: ProjectSettings }>(
        '/api/admin/project-defaults',
        draft,
      );
      setDraft(fresh);
      await qc.invalidateQueries({ queryKey: qk.admin('project-defaults') });
    }
    await settings.commit();
  }, t('defaults.saved'));

  // Amorce l'édition depuis les valeurs serveur (ajustement d'état pendant le render).
  if (saved && !draft) setDraft(saved);
  if (!draft || !saved) return <QueryState query={defaultsQ} skeleton={<SkeletonRows count={3} />} />;

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

  const policy = settings.draft[TASK_POLICY_KEY] ?? settings.stored[TASK_POLICY_KEY] ?? '';

  return (
    <div className="max-w-2xl">
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">{t('defaults.hint')}</p>

        <NumberingPanel value={draft.nomenclature} onChange={setNom} />

        <FormatPanel
          value={draft}
          onResolution={setRes}
          onFramerate={setFps}
          startFrame={
            <SettingsFields
              fields={settings.fields}
              stored={settings.stored}
              draft={settings.draft}
              units={settings.units}
              onChange={settings.setValue}
              onUnit={settings.setUnit}
            />
          }
        />

        <Panel title={t('defaults.departments')}>
          <DepartmentsEditor
            value={draft.departments}
            onChange={(departments) => setDraft((d) => d && { ...d, departments })}
          />
        </Panel>

        <TaskPolicyField value={policy} onChange={(v) => settings.setValue(TASK_POLICY_KEY, v)} />

        <ProjectNamingSection
          value={draft.naming ?? { pattern: '', mode: 'off' }}
          onChange={(naming) => setDraft((d) => d && { ...d, naming })}
        />

        <ProjectReviewRequestSection
          value={draft.reviewRequest ?? { requireNote: false, minNoteLength: 5 }}
          onChange={(reviewRequest) => setDraft((d) => d && { ...d, reviewRequest })}
        />

        <ProjectDefaultLightingSection
          value={draft.defaultLighting}
          onChange={(defaultLighting) => setDraft((d) => d && { ...d, defaultLighting })}
        />

        <ProjectColorSection
          value={draft.color}
          onChange={(color) => setDraft((d) => d && { ...d, color })}
        />

        <SettingsPointer section="distribution" label={t('review.delivery')} hint={t('burnin.title')} />
      </div>

      <SaveBar
        dirty={!sameValue(saved, draft) || settings.dirty}
        busy={busy}
        onSave={() => void save()}
        onDiscard={() => {
          setDraft(saved);
          settings.discard();
        }}
      />
    </div>
  );
}
